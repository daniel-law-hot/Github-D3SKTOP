import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { IHotFlowState } from '../../../models/hotflow'
import { IBranchesState, ICompareState } from '../../../lib/app-state'
import { TipState } from '../../../models/tip'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Ref } from '../../lib/ref'
import {
  IPreflightCheck,
  describeUpdateReleaseCommands,
  preflightUpdateRelease,
} from '../../../lib/hotflow/actions'
import { PreflightChecks } from './preflight-checks'
import { CommandPreview } from './command-preview'
import { extractVsoNumbersFromCommits } from '../../../lib/hotflow/branch-patterns'

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

    const result = await preflightUpdateRelease(
      repository,
      release,
      integrationBranch
    )

    this.setState({
      checks: result.checks,
      canProceed: result.canProceed,
      isChecking: false,
    })
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
            Merges <Ref>{this.props.hotFlowState.integrationBranchName}</Ref>{' '}
            into <Ref>{release.branch.nameWithoutRemote}</Ref>, bringing in
            everything that's landed since the last update.
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

          <PreflightChecks
            checks={this.state.checks}
            isLoading={this.state.isChecking}
          />

          <p className="hotflow-dialog-note">
            If the merge conflicts, Desktop's conflict resolution will open as
            usual.
          </p>

          <CommandPreview
            commands={describeUpdateReleaseCommands(
              release,
              this.props.hotFlowState.integrationBranchName
            )}
          />
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={__DARWIN__ ? 'Merge' : 'Merge'}
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

    // Matches `Branch -> Update from develop`. Initialising the operation is what
    // registers it as a merge in progress, and that's what gives a conflict
    // Desktop's usual resolution flow instead of leaving the working directory
    // conflicted with nothing on screen. It throws on an invalid tip, which the
    // check above has already ruled out.
    dispatcher.initializeMergeOperation(repository, false, integrationBranch)

    await dispatcher.mergeBranch(
      repository,
      integrationBranch,
      this.props.compareState.mergeStatus
    )

    await dispatcher.refreshHotFlow(repository)

    this.props.onDismissed()
  }

  /** Whether HEAD is on the named branch, by its short name. */
  private isOnBranch(name: string): boolean {
    const { tip } = this.props.branchesState

    return tip.kind === TipState.Valid && tip.branch.nameWithoutRemote === name
  }
}
