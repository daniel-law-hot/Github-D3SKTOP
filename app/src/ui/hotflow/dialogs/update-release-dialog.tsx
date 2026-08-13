import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { IHotFlowState } from '../../../models/hotflow'
import { IBranchesState, ICompareState } from '../../../lib/app-state'
import { TipState } from '../../../models/tip'
import { Branch, BranchType } from '../../../models/branch'
import { FetchType } from '../../../models/fetch'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Ref } from '../../lib/ref'
import {
  IPreflightCheck,
  describeUpdateReleaseCommands,
  preflightUpdateRelease,
} from '../../../lib/hotflow/actions'
import { GitRepositoryProvider } from '../../../lib/hotflow/git-repository-provider'
import { PreflightChecks } from './preflight-checks'
import { CommandPreview } from './command-preview'
import { extractVsoNumbersFromCommits } from '../../../lib/hotflow/branch-patterns'
import { Select } from '../../lib/select'
import { MergeResult } from '../../../lib/git'

/**
 * How to bring the integration branch into the release.
 *
 * `merge` records the update as a merge commit and works whatever state the
 * release is in. `fast-forward` moves the release pointer instead, leaving no
 * merge commits behind — only possible while the release has nothing of its own,
 * which is the common case for a release branch that's only ever been a snapshot
 * of develop.
 */
type UpdateMethod = 'merge' | 'fast-forward'

interface IUpdateReleaseDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly hotFlowState: IHotFlowState

  /**
   * Needed to confirm the checkout actually happened before merging, and to pass
   * the same merge status `Branch -> Update from develop` passes.
   */
  readonly branchesState: IBranchesState
  readonly compareState: ICompareState

  readonly onDismissed: () => void
}

interface IUpdateReleaseDialogState {
  readonly checks: ReadonlyArray<IPreflightCheck>
  readonly canProceed: boolean
  readonly isChecking: boolean
  readonly isMerging: boolean
  readonly method: UpdateMethod
}

/**
 * Merge `development` into the current release branch.
 *
 * Conflicts are handed to Desktop's existing merge machinery, which already has
 * a conflict resolution flow — there's no reason for HotFlow to grow its own.
 */
export class UpdateReleaseDialog extends React.Component<
  IUpdateReleaseDialogProps,
  IUpdateReleaseDialogState
> {
  public constructor(props: IUpdateReleaseDialogProps) {
    super(props)
    this.state = {
      checks: [],
      canProceed: false,
      isChecking: true,
      isMerging: false,
      method: 'merge',
    }
  }

  public componentDidMount() {
    this.runChecks()
  }

  private async runChecks() {
    const { repository, hotFlowState } = this.props
    const release = hotFlowState.currentRelease
    const integrationBranch = hotFlowState.integrationBranch

    if (release === null || integrationBranch === null) {
      this.setState({ isChecking: false, canProceed: false })
      return
    }

    // Checked against the ref the merge will actually use, not the resolved
    // integration branch — those differ whenever the local `develop` is behind
    // its remote, and "can this fast-forward" answered about the wrong ref is
    // worse than not asking.
    const result = await preflightUpdateRelease(
      new GitRepositoryProvider(repository),
      release,
      this.mergeSource(integrationBranch),
      this.state.method === 'fast-forward'
    )

    this.setState({
      checks: result.checks,
      canProceed: result.canProceed,
      isChecking: false,
    })
  }

  private onMethodChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ): void => {
    const method = event.currentTarget.value as UpdateMethod

    // Whether a fast-forward is possible is one of the checks, so the answer on
    // screen belongs to the method that was selected when it ran.
    this.setState({ method, isChecking: true }, () => this.runChecks())
  }

  public render() {
    const { hotFlowState } = this.props
    const release = hotFlowState.currentRelease

    if (release === null) {
      return (
        <Dialog
          id="hotflow-update-release"
          title={__DARWIN__ ? 'Update Release' : 'Update release'}
          onDismissed={this.props.onDismissed}
          onSubmit={this.props.onDismissed}
        >
          <DialogError>
            There's no release branch to update in this repository.
          </DialogError>
          <DialogFooter>
            <OkCancelButtonGroup
              okButtonText="Close"
              cancelButtonVisible={false}
            />
          </DialogFooter>
        </Dialog>
      )
    }

    const incomingVsos = extractVsoNumbersFromCommits(release.incomingCommits)

    const disabled =
      !this.state.canProceed || this.state.isChecking || this.state.isMerging

    const isFastForward = this.state.method === 'fast-forward'
    const integrationName = this.props.hotFlowState.integrationBranchName
    const branchName = release.branch.nameWithoutRemote

    return (
      <Dialog
        id="hotflow-update-release"
        title={
          __DARWIN__
            ? 'Update Release from Development'
            : 'Update release from development'
        }
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isMerging}
        disabled={this.state.isMerging}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            {isFastForward ? (
              <>
                Moves <Ref>{branchName}</Ref> up to <Ref>{integrationName}</Ref>
                , bringing in everything that's landed since the last update
                without recording a merge.
              </>
            ) : (
              <>
                Merges <Ref>{integrationName}</Ref> into <Ref>{branchName}</Ref>
                , bringing in everything that's landed since the last update.
              </>
            )}
          </p>

          <div className="hotflow-ship-stats">
            <div>
              <span className="hotflow-ship-value num">
                {release.behindIntegration}
              </span>
              <span className="hotflow-ship-label">commits coming in</span>
            </div>
            <div>
              <span className="hotflow-ship-value num">
                {incomingVsos.length}
              </span>
              <span className="hotflow-ship-label">work items</span>
            </div>
          </div>

          {incomingVsos.length > 0 && (
            <div className="hotflow-vso-chips">
              <span className="hotflow-vso-chips-label">Bringing in</span>
              <span className="hotflow-vso-chips-list">
                {incomingVsos.map(vso => (
                  <span className="hotflow-vso-chip mono" key={vso}>
                    {vso}
                  </span>
                ))}
              </span>
            </div>
          )}

          <Select
            label="Update method"
            value={this.state.method}
            onChange={this.onMethodChanged}
            disabled={this.state.isMerging}
          >
            <option value="merge">Merge (records a merge commit)</option>
            <option value="fast-forward">Fast-forward (no merge commit)</option>
          </Select>

          <PreflightChecks
            checks={this.state.checks}
            isLoading={this.state.isChecking}
          />

          <p className="hotflow-dialog-note">
            {isFastForward
              ? `A fast-forward can't conflict — git either moves ${branchName} or ` +
                `declines and changes nothing.`
              : `If the merge conflicts, Desktop's conflict resolution will open as usual.`}
          </p>

          <CommandPreview
            commands={describeUpdateReleaseCommands(
              release,
              this.props.hotFlowState.integrationBranch === null
                ? integrationName
                : this.mergeSource(this.props.hotFlowState.integrationBranch)
                    .name,
              isFastForward
            )}
          />
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={isFastForward ? 'Fast-forward' : 'Merge'}
            okButtonDisabled={disabled}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onSubmit = async () => {
    const { repository, dispatcher, hotFlowState } = this.props
    const release = hotFlowState.currentRelease
    const integrationBranch = hotFlowState.integrationBranch

    if (release === null || integrationBranch === null) {
      return
    }

    this.setState({ isMerging: true })

    // Fetch first, or this merges whatever the local integration branch last
    // pulled. The diagram can say "2 behind" while the remote has moved further,
    // and updating a release from a stale copy of develop is the failure this
    // whole action exists to prevent.
    await dispatcher.fetch(repository, FetchType.UserInitiatedTask)

    // Merging happens on the release branch, so make sure we're on it first.
    await dispatcher.checkoutBranch(repository, release.branch)

    // `checkoutBranch` resolves whether or not it switched: with uncommitted
    // changes it shows the stash prompt and returns, leaving HEAD where it was.
    // Merging then would put the integration branch into whatever is actually
    // checked out — main, or a feature branch — so this has to be verified rather
    // than assumed. The prompt is on screen; the user can come back.
    if (!this.isOnBranch(release.branch.nameWithoutRemote)) {
      this.setState({ isMerging: false })
      this.props.onDismissed()
      return
    }

    const mergeSource = this.mergeSource(integrationBranch)

    if (this.state.method === 'fast-forward') {
      // No merge operation to initialise: git refuses outright rather than
      // leaving a conflict behind, so there's nothing for the resolution flow to
      // pick up. An outright refusal comes back as `undefined` with the error
      // already on screen, and pushing an unchanged branch afterwards would be
      // pointless — so only Success is worth following up.
      const result = await dispatcher.fastForwardBranch(repository, mergeSource)

      if (result === MergeResult.Success) {
        await dispatcher.push(repository)
      }
    } else {
      // Matches `Branch -> Update from develop`. Initialising the operation is
      // what registers it as a merge in progress, and that's what gives a
      // conflict Desktop's usual resolution flow instead of leaving the working
      // directory conflicted with nothing on screen. It throws on an invalid tip,
      // which the check above has already ruled out.
      dispatcher.initializeMergeOperation(repository, false, mergeSource)

      await dispatcher.mergeBranch(
        repository,
        mergeSource,
        this.props.compareState.mergeStatus
      )

      // Merging into a release branch nobody else can see achieves nothing — the
      // people testing the release are looking at the remote. Skipped when the
      // merge left conflicts behind, since pushing a conflicted tree isn't
      // possible and Desktop's resolution flow now owns the operation.
      if (this.isOnBranch(release.branch.nameWithoutRemote)) {
        await dispatcher.push(repository)
      }
    }

    await dispatcher.refreshHotFlow(repository)

    this.props.onDismissed()
  }

  /**
   * The ref to merge: the integration branch's remote counterpart when it has one.
   *
   * A fetch updates `origin/develop`, never the local `develop` — so merging the
   * local branch would make the fetch above pointless and quietly bring in less
   * than the remote holds. Falls back to the resolved branch when there's no
   * remote counterpart, which is the case for a repository that only has local
   * branches.
   */
  private mergeSource(integrationBranch: Branch): Branch {
    if (integrationBranch.type === BranchType.Remote) {
      return integrationBranch
    }

    const remote = this.props.branchesState.allBranches.find(
      b =>
        b.type === BranchType.Remote &&
        !b.isDesktopForkRemoteBranch &&
        b.nameWithoutRemote === integrationBranch.nameWithoutRemote
    )

    return remote ?? integrationBranch
  }

  /** Whether HEAD is on the named branch, by its short name. */
  private isOnBranch(name: string): boolean {
    const { tip } = this.props.branchesState

    return tip.kind === TipState.Valid && tip.branch.nameWithoutRemote === name
  }
}
