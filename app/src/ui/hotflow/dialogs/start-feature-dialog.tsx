import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { IHotFlowState } from '../../../models/hotflow'
import { Branch } from '../../../models/branch'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { TextBox } from '../../lib/text-box'
import { Select } from '../../lib/select'
import { Ref } from '../../lib/ref'
import {
  StartBranchKind,
  buildFeatureBranchName,
  buildHotfixBranchName,
  buildReleaseBranchName,
  slugifyDescription,
} from '../../../lib/hotflow/branch-patterns'
import {
  IPreflightCheck,
  IStartBranchBase,
  describeStartBranchCommands,
  preflightStartBranch,
} from '../../../lib/hotflow/actions'
import { GitRepositoryProvider } from '../../../lib/hotflow/git-repository-provider'
import { PreflightChecks } from './preflight-checks'
import { CommandPreview } from './command-preview'

interface IStartFeatureDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly hotFlowState: IHotFlowState
  readonly allBranches: ReadonlyArray<Branch>
  readonly onDismissed: () => void
}

interface IStartFeatureDialogState {
  readonly kind: StartBranchKind
  readonly vso: string
  readonly description: string

  /** Kept apart from `vso` so switching kind doesn't mangle what you typed. */
  readonly version: string

  readonly checks: ReadonlyArray<IPreflightCheck>
  readonly canProceed: boolean
  readonly isChecking: boolean
  readonly isCreating: boolean
}

/**
 * Start a branch, named to the convention.
 *
 * The convention is `feature/{vso}-{description}`, and `hotfix/{vso}-…` for a
 * fix to something already in a release. Building the name here rather than
 * leaving it to the New Branch dialog means it can't be mistyped, and the VSO
 * number is captured as a number rather than hoped for.
 *
 * A release can be cut from here too, which is a convenience rather than the
 * way to do it — Start release exists for that and checks a good deal more.
 */
export class StartFeatureDialog extends React.Component<
  IStartFeatureDialogProps,
  IStartFeatureDialogState
> {
  public constructor(props: IStartFeatureDialogProps) {
    super(props)
    this.state = {
      kind: 'feature',
      vso: '',
      description: '',
      version: '',
      checks: [],
      canProceed: false,
      isChecking: false,
      isCreating: false,
    }
  }

  public componentDidMount() {
    this.runChecks()
  }

  /** True while the kind is one named from a work item and a description. */
  private get isWorkBranch(): boolean {
    return this.state.kind !== 'release'
  }

  private get branchName(): string | null {
    if (this.state.kind === 'release') {
      const version = this.state.version.trim()

      return version.length === 0 ? null : buildReleaseBranchName(version)
    }

    const vso = parseInt(this.state.vso, 10)

    if (!Number.isFinite(vso) || vso <= 0) {
      return null
    }

    // A description that slugifies to nothing — punctuation only, say — is no
    // description at all, so it fails the same way an empty one does.
    if (slugifyDescription(this.state.description).length === 0) {
      return null
    }

    return this.state.kind === 'hotfix'
      ? buildHotfixBranchName(vso, this.state.description)
      : buildFeatureBranchName(vso, this.state.description)
  }

  /**
   * The branch this one is cut from.
   *
   * A hotfix starts from the release in flight, so it carries what is being
   * tested rather than everything unreleased on the integration branch. A
   * feature and a release both start from integration.
   */
  private get base(): IStartBranchBase {
    const { hotFlowState } = this.props

    if (this.state.kind === 'hotfix') {
      const release = hotFlowState.currentRelease

      return {
        name: release?.branch.nameWithoutRemote ?? 'a release branch',
        branch: release?.branch ?? null,
      }
    }

    return {
      name: hotFlowState.integrationBranchName,
      branch: hotFlowState.integrationBranch,
    }
  }

  /** The ref handed to `git checkout`: the remote counterpart where there is one. */
  private get startRef(): string | null {
    const { branch } = this.base

    return branch === null ? null : branch.upstream ?? branch.name
  }

  private async runChecks() {
    const branchName = this.branchName

    if (branchName === null) {
      this.setState({ checks: [], canProceed: false, isChecking: false })
      return
    }

    this.setState({ isChecking: true })

    const result = await preflightStartBranch(
      new GitRepositoryProvider(this.props.repository),
      this.props.hotFlowState,
      branchName,
      this.props.allBranches,
      this.base
    )

    this.setState({
      checks: result.checks,
      canProceed: result.canProceed,
      isChecking: false,
    })
  }

  public render() {
    const branchName = this.branchName
    const startRef = this.startRef
    const disabled =
      branchName === null ||
      !this.state.canProceed ||
      this.state.isChecking ||
      this.state.isCreating

    return (
      <Dialog
        id="hotflow-start-feature"
        title={this.title}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isCreating}
        disabled={this.state.isCreating}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">{this.renderLede()}</p>

          <Select
            label="Branch type"
            value={this.state.kind}
            onChange={this.onKindChanged}
            disabled={this.state.isCreating}
          >
            <option value="feature">Feature</option>
            <option value="hotfix">Hotfix</option>
            <option value="release">Release</option>
          </Select>

          {this.isWorkBranch ? (
            <>
              <TextBox
                label="VSO number"
                value={this.state.vso}
                onValueChanged={this.onVsoChanged}
                placeholder="100712"
                autoFocus={true}
              />

              <TextBox
                label="Description"
                value={this.state.description}
                onValueChanged={this.onDescriptionChanged}
                placeholder={
                  this.state.kind === 'hotfix'
                    ? 'Fix quote totals rounding'
                    : 'Fix login redirect'
                }
              />
            </>
          ) : (
            <TextBox
              label="Release"
              value={this.state.version}
              onValueChanged={this.onVersionChanged}
              placeholder="1.2026.17"
              autoFocus={true}
            />
          )}

          <div className="hotflow-name-preview">
            <span className="hotflow-name-preview-label">Creates</span>
            <span className="hotflow-name-preview-value mono">
              {branchName ?? '—'}
            </span>
          </div>

          <PreflightChecks
            checks={this.state.checks}
            isLoading={this.state.isChecking}
          />

          {branchName !== null && startRef !== null && (
            <CommandPreview
              commands={describeStartBranchCommands(branchName, startRef)}
            />
          )}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={__DARWIN__ ? 'Create Branch' : 'Create branch'}
            okButtonDisabled={disabled}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private get title(): string {
    switch (this.state.kind) {
      case 'hotfix':
        return __DARWIN__ ? 'Start Hotfix Branch' : 'Start hotfix branch'
      case 'release':
        return __DARWIN__ ? 'Start Release Branch' : 'Start release branch'
      case 'feature':
        return __DARWIN__ ? 'Start Feature Branch' : 'Start feature branch'
    }
  }

  private renderLede() {
    const { name } = this.base
    const { kind } = this.state

    if (kind === 'hotfix') {
      return (
        <>
          Branches from <Ref>{name}</Ref>, so the fix sits on top of what's
          being tested rather than on everything unreleased.
        </>
      )
    }

    if (kind === 'release') {
      return (
        <>
          Branches from <Ref>{name}</Ref>. This only cuts the branch — Start
          release is the one that checks the version hasn't shipped and offers
          to push it.
        </>
      )
    }

    return (
      <>
        Branches from <Ref>{name}</Ref> using the House of Travel naming
        convention.
      </>
    )
  }

  private onKindChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    const kind = event.currentTarget.value as StartBranchKind

    // The name, the base branch and so the checks all change with it.
    this.setState({ kind }, () => this.runChecks())
  }

  private onVsoChanged = (vso: string) => {
    // Numbers only — the convention has no room for anything else.
    this.setState({ vso: vso.replace(/[^0-9]/g, '') }, () => this.runChecks())
  }

  private onDescriptionChanged = (description: string) => {
    this.setState({ description }, () => this.runChecks())
  }

  private onVersionChanged = (version: string) => {
    this.setState({ version }, () => this.runChecks())
  }

  private onSubmit = async () => {
    const branchName = this.branchName

    // Prefer the remote tracking ref so the branch starts from what's actually
    // on the server rather than a stale local copy.
    const startPoint = this.startRef

    if (branchName === null || startPoint === null) {
      return
    }

    this.setState({ isCreating: true })

    const { repository, dispatcher } = this.props

    // `noTrack`, and it is not optional. Branching from `origin/develop` without
    // it makes the new branch track develop, so the first push aims at develop
    // rather than at the feature branch:
    //
    //   ! [remote rejected] feature/107958-… -> develop
    //
    // House of Travel's branch protection refused that, which is the only reason
    // it surfaced as an error rather than as feature work landing straight on
    // develop. A new feature branch should track nothing; it gets its own upstream
    // when it's first pushed.
    await dispatcher.createBranch(repository, branchName, startPoint, true)
    await dispatcher.refreshHotFlow(repository)

    this.props.onDismissed()
  }
}
