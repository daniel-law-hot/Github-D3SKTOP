import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { IHotFlowState } from '../../../models/hotflow'
import { Branch } from '../../../models/branch'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { TextBox } from '../../lib/text-box'
import { Ref } from '../../lib/ref'
import { buildReleaseBranchName } from '../../../lib/hotflow/branch-patterns'
import {
  IPreflightCheck,
  describeStartBranchCommands,
  preflightStartRelease,
} from '../../../lib/hotflow/actions'
import { PreflightChecks } from './preflight-checks'
import { CommandPreview } from './command-preview'

interface IStartReleaseDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly hotFlowState: IHotFlowState
  readonly allBranches: ReadonlyArray<Branch>
  readonly onDismissed: () => void
}

interface IStartReleaseDialogState {
  readonly version: string
  readonly checks: ReadonlyArray<IPreflightCheck>
  readonly canProceed: boolean
  readonly isChecking: boolean
  readonly isCreating: boolean
}

/**
 * Cut a new release branch off the integration branch.
 *
 * The version is pre-filled from this repository's highest known version plus one,
 * and it's a suggestion rather than an answer — the third segment is the calendar
 * cycle, so a repository that skipped a cycle skipped a number and the pre-fill
 * will be low. See `computeNextVersion`. The field is editable for exactly that
 * reason, and the branch name preview and preflight checks follow what's typed.
 */
export class StartReleaseDialog extends React.Component<
  IStartReleaseDialogProps,
  IStartReleaseDialogState
> {
  public constructor(props: IStartReleaseDialogProps) {
    super(props)
    this.state = {
      version: props.hotFlowState.nextVersion ?? '',
      checks: [],
      canProceed: false,
      isChecking: false,
      isCreating: false,
    }
  }

  public componentDidMount() {
    this.runChecks()
  }

  private get branchName(): string | null {
    const version = this.state.version.trim()

    if (version.length === 0) {
      return null
    }

    return buildReleaseBranchName(version)
  }

  private async runChecks() {
    const branchName = this.branchName

    if (branchName === null) {
      this.setState({ checks: [], canProceed: false, isChecking: false })
      return
    }

    this.setState({ isChecking: true })

    const result = await preflightStartRelease(
      this.props.repository,
      this.props.hotFlowState,
      this.state.version.trim(),
      branchName,
      this.props.allBranches
    )

    this.setState({
      checks: result.checks,
      canProceed: result.canProceed,
      isChecking: false,
    })
  }

  public render() {
    const { hotFlowState } = this.props
    const branchName = this.branchName
    const disabled =
      branchName === null ||
      !this.state.canProceed ||
      this.state.isChecking ||
      this.state.isCreating

    const lastShipped =
      hotFlowState.releaseHistory.length > 0
        ? hotFlowState.releaseHistory[0].tagName
        : null

    return (
      <Dialog
        id="hotflow-start-release"
        title={__DARWIN__ ? 'Start Release Branch' : 'Start release branch'}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isCreating}
        disabled={this.state.isCreating}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            Cuts a release branch from{' '}
            <Ref>origin/{this.props.hotFlowState.integrationBranchName}</Ref>,
            taking everything currently on it.
          </p>

          <TextBox
            label="Version"
            value={this.state.version}
            onValueChanged={this.onVersionChanged}
            placeholder="1.2026.9"
            autoFocus={true}
          />

          <div className="hotflow-name-preview">
            <span className="hotflow-name-preview-label">Creates</span>
            <span className="hotflow-name-preview-value mono">
              {branchName ?? '—'}
            </span>
          </div>

          <div className="hotflow-ship-stats">
            <div>
              <span className="hotflow-ship-value num">
                {hotFlowState.unreleasedCommitCount}
              </span>
              <span className="hotflow-ship-label">commits</span>
            </div>
            <div>
              <span className="hotflow-ship-value num">
                {hotFlowState.unreleasedVsoCount}
              </span>
              <span className="hotflow-ship-label">work items</span>
            </div>
            <div>
              <span className="hotflow-ship-value mono">
                {lastShipped ?? '—'}
              </span>
              <span className="hotflow-ship-label">last shipped</span>
            </div>
          </div>

          <PreflightChecks
            checks={this.state.checks}
            isLoading={this.state.isChecking}
          />

          {branchName !== null && (
            <CommandPreview
              commands={describeStartBranchCommands(
                branchName,
                this.props.hotFlowState.integrationBranchName
              )}
            />
          )}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={
              __DARWIN__ ? 'Create Release Branch' : 'Create release branch'
            }
            okButtonDisabled={disabled}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onVersionChanged = (version: string) => {
    this.setState({ version }, () => this.runChecks())
  }

  private onSubmit = async () => {
    const branchName = this.branchName

    if (branchName === null) {
      return
    }

    this.setState({ isCreating: true })

    const { repository, dispatcher, hotFlowState } = this.props
    const integrationBranch = hotFlowState.integrationBranch

    const startPoint =
      integrationBranch?.upstream ?? integrationBranch?.name ?? null

    // `noTrack` — see the note in the start feature dialog. Branching from
    // `origin/develop` with tracking on points the new branch's push at develop,
    // which for a release branch means the branch you cut to stabilise a release
    // would try to write back into the integration branch.
    await dispatcher.createBranch(repository, branchName, startPoint, true)
    await dispatcher.refreshHotFlow(repository)

    this.props.onDismissed()
  }
}
