import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { IHotFlowState } from '../../../models/hotflow'
import { Branch } from '../../../models/branch'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { TextBox } from '../../lib/text-box'
import { Ref } from '../../lib/ref'
import {
  buildFeatureBranchName,
  slugifyDescription,
} from '../../../lib/hotflow/branch-patterns'
import {
  IPreflightCheck,
  describeStartBranchCommands,
  preflightStartBranch,
} from '../../../lib/hotflow/actions'
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
  readonly vso: string
  readonly description: string
  readonly checks: ReadonlyArray<IPreflightCheck>
  readonly canProceed: boolean
  readonly isChecking: boolean
  readonly isCreating: boolean
}

/**
 * Start a feature branch, named to the convention.
 *
 * The convention is `feature/{vso}-{description}`. Building the name here rather
 * than leaving it to the New Branch dialog means it can't be mistyped, and the
 * VSO number is captured as a number rather than hoped for.
 */
export class StartFeatureDialog extends React.Component<
  IStartFeatureDialogProps,
  IStartFeatureDialogState
> {
  public constructor(props: IStartFeatureDialogProps) {
    super(props)
    this.state = {
      vso: '',
      description: '',
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
    const vso = parseInt(this.state.vso, 10)

    if (!Number.isFinite(vso) || vso <= 0) {
      return null
    }

    const slug = slugifyDescription(this.state.description)

    if (slug.length === 0) {
      return null
    }

    return buildFeatureBranchName(vso, this.state.description)
  }

  private async runChecks() {
    const branchName = this.branchName

    if (branchName === null) {
      this.setState({ checks: [], canProceed: false, isChecking: false })
      return
    }

    this.setState({ isChecking: true })

    const result = await preflightStartBranch(
      this.props.repository,
      this.props.hotFlowState,
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
    const branchName = this.branchName
    const disabled =
      branchName === null ||
      !this.state.canProceed ||
      this.state.isChecking ||
      this.state.isCreating

    return (
      <Dialog
        id="hotflow-start-feature"
        title={__DARWIN__ ? 'Start Feature Branch' : 'Start feature branch'}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isCreating}
        disabled={this.state.isCreating}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            Branches from{' '}
            <Ref>origin/{this.props.hotFlowState.integrationBranchName}</Ref>{' '}
            using the House of Travel naming convention.
          </p>

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
            placeholder="Fix login redirect"
          />

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
            okButtonText={__DARWIN__ ? 'Create Branch' : 'Create branch'}
            okButtonDisabled={disabled}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onVsoChanged = (vso: string) => {
    // Numbers only — the convention has no room for anything else.
    this.setState({ vso: vso.replace(/[^0-9]/g, '') }, () => this.runChecks())
  }

  private onDescriptionChanged = (description: string) => {
    this.setState({ description }, () => this.runChecks())
  }

  private onSubmit = async () => {
    const branchName = this.branchName

    if (branchName === null) {
      return
    }

    this.setState({ isCreating: true })

    const { repository, dispatcher, hotFlowState } = this.props
    const integrationBranch = hotFlowState.integrationBranch

    // Prefer the remote tracking ref so the branch starts from what's actually
    // on the server rather than a stale local copy.
    const startPoint =
      integrationBranch?.upstream ?? integrationBranch?.name ?? null

    await dispatcher.createBranch(repository, branchName, startPoint)
    await dispatcher.refreshHotFlow(repository)

    this.props.onDismissed()
  }
}
