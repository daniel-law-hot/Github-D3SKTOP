import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Branch } from '../../../models/branch'
import {
  IHotFlowState,
  IntegrationBranchAliases,
  ProductionBranchAliases,
} from '../../../models/hotflow'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Select } from '../../lib/select'

interface IEditBranchesDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly hotFlowState: IHotFlowState
  readonly allBranches: ReadonlyArray<Branch>
  readonly onDismissed: () => void
}

interface IEditBranchesDialogState {
  readonly integrationBranch: string
  readonly productionBranch: string
  readonly isSaving: boolean
}

/** The sentinel for "work it out from the known aliases". */
const AutoValue = ''

/**
 * Pin the integration and production branches for a repository.
 *
 * HotFlow resolves these from a list of known aliases, which covers every House
 * of Travel repository — this is the escape hatch for one that deviates, and the
 * way out when a repository has neither so the view is otherwise disabled.
 */
export class EditBranchesDialog extends React.Component<
  IEditBranchesDialogProps,
  IEditBranchesDialogState
> {
  public constructor(props: IEditBranchesDialogProps) {
    super(props)

    const { integrationResolution, productionResolution } = props.hotFlowState

    // Only prefill as an explicit choice when the user pinned it before;
    // an alias or default-branch match stays on "Automatic".
    this.state = {
      integrationBranch:
        integrationResolution?.resolution === 'override'
          ? integrationResolution.branch.nameWithoutRemote
          : AutoValue,
      productionBranch:
        productionResolution?.resolution === 'override'
          ? productionResolution.branch.nameWithoutRemote
          : AutoValue,
      isSaving: false,
    }
  }

  /**
   * Candidate branch names, deduplicated across local and remote so
   * `main` and `origin/main` appear once.
   */
  private get branchNames(): ReadonlyArray<string> {
    const names = new Set<string>()

    for (const branch of this.props.allBranches) {
      if (branch.isDesktopForkRemoteBranch) {
        continue
      }

      // Release and feature branches are never the integration or production
      // branch, and listing dozens of them makes the picker useless.
      const name = branch.nameWithoutRemote
      if (name.startsWith('release/') || name.startsWith('feature/')) {
        continue
      }

      names.add(name)
    }

    return [...names].sort((a, b) => a.localeCompare(b))
  }

  public render() {
    return (
      <Dialog
        id="hotflow-edit-branches"
        title={__DARWIN__ ? 'HotFlow Branches' : 'HotFlow branches'}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isSaving}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            HotFlow works these out automatically, trying{' '}
            {formatAliases(IntegrationBranchAliases)} for integration and{' '}
            {formatAliases(ProductionBranchAliases)} for production. Pin them
            here if this repository does something different.
          </p>

          <Select
            label="Integration branch"
            value={this.state.integrationBranch}
            onChange={this.onIntegrationChanged}
          >
            <option value={AutoValue}>
              Automatic ({this.describeResolution('integration')})
            </option>
            {this.branchNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>

          <Select
            label="Production branch"
            value={this.state.productionBranch}
            onChange={this.onProductionChanged}
          >
            <option value={AutoValue}>
              Automatic ({this.describeResolution('production')})
            </option>
            {this.branchNames.map(name => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>

          <p className="hotflow-dialog-note">
            Remembered for this repository only. Everything HotFlow shows —
            drift, release history, what would ship — is measured against these
            two branches.
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Save"
            okButtonDisabled={this.state.isSaving}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  /** Describes what automatic resolution currently produces, or that it fails. */
  private describeResolution(which: 'integration' | 'production'): string {
    const resolution =
      which === 'integration'
        ? this.props.hotFlowState.integrationResolution
        : this.props.hotFlowState.productionResolution

    if (resolution === null) {
      return 'nothing found'
    }

    const name = resolution.branch.nameWithoutRemote

    switch (resolution.resolution) {
      case 'alias':
        return resolution.remoteOnly ? `${name}, on the remote` : name
      case 'default-branch':
        return `${name}, the default branch`
      case 'override':
        // Shown when a previous pin is being replaced.
        return name
      default:
        return name
    }
  }

  private onIntegrationChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.setState({ integrationBranch: event.currentTarget.value })
  }

  private onProductionChanged = (event: React.FormEvent<HTMLSelectElement>) => {
    this.setState({ productionBranch: event.currentTarget.value })
  }

  private onSubmit = async () => {
    this.setState({ isSaving: true })

    await this.props.dispatcher.setHotFlowBranches(this.props.repository, {
      integrationBranch: this.state.integrationBranch,
      productionBranch: this.state.productionBranch,
    })

    this.props.onDismissed()
  }
}

/** `develop`, `development` or `dev` — for prose. */
function formatAliases(aliases: ReadonlyArray<string>): string {
  if (aliases.length <= 1) {
    return aliases.join('')
  }

  return `${aliases.slice(0, -1).join(', ')} or ${aliases[aliases.length - 1]}`
}
