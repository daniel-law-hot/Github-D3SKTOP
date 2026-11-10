import * as React from 'react'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { IMergedBranchesState } from '../../models/hotflow'
import {
  CleanupMinAgeDays,
  ICleanupBranch,
} from '../../lib/hotflow/branch-cleanup'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { RelativeTime } from '../relative-time'
import { TooltippedContent } from '../lib/tooltipped-content'

interface IMergedBranchRowProps {
  readonly branch: ICleanupBranch
  readonly isDeleting: boolean
  readonly error: string | null
  readonly onDelete: (branch: ICleanupBranch) => void
}

class MergedBranchRow extends React.Component<IMergedBranchRowProps> {
  private onClick = () => {
    this.props.onDelete(this.props.branch)
  }

  public render() {
    const { branch, isDeleting, error } = this.props

    return (
      <li className="hotflow-forgotten-item">
        <TooltippedContent
          className="mono hotflow-forgotten-name"
          tooltip={branch.name}
        >
          {branch.name}
        </TooltippedContent>
        <div className="hotflow-forgotten-meta">
          {branch.local !== null && (
            <span className="hotflow-forgotten-badge">local</span>
          )}
          {branch.remote !== null && (
            <span className="hotflow-forgotten-badge">remote</span>
          )}
          <span>
            last commit{' '}
            <RelativeTime
              date={new Date(branch.lastCommitAt)}
              onlyRelative={true}
            />
          </span>
        </div>
        {error !== null && (
          <div className="hotflow-cleanup-failures" role="alert">
            Could not delete: {error}
          </div>
        )}
        <div className="hotflow-forgotten-actions">
          <Button onClick={this.onClick} disabled={isDeleting}>
            {isDeleting ? 'Deleting…' : 'Delete local and remote'}
          </Button>
        </div>
      </li>
    )
  }
}

interface IMergedBranchesPanelProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly merged: IMergedBranchesState
  readonly integrationBranchName: string
}

interface IMergedBranchesPanelState {
  /** Branches being deleted now, so their buttons can't be pressed twice. */
  readonly deleting: ReadonlySet<string>

  /** What went wrong the last time, by branch, until it is tried again. */
  readonly failures: ReadonlyMap<string, string>
}

/**
 * The user's branches that are already in develop and have sat for two weeks,
 * with a button to delete each, locally and on the remote, in one click.
 *
 * Also where the delete-when-merged option lives, since this is where its effect
 * shows: with it on, this list stays empty apart from branches that would not go.
 */
export class MergedBranchesPanel extends React.Component<
  IMergedBranchesPanelProps,
  IMergedBranchesPanelState
> {
  private isUnmounted = false

  public constructor(props: IMergedBranchesPanelProps) {
    super(props)
    this.state = { deleting: new Set(), failures: new Map() }
  }

  public componentWillUnmount() {
    this.isUnmounted = true
  }

  private onAutoDeleteChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.props.dispatcher.setAutoDeleteMergedBranches(
      this.props.repository,
      event.currentTarget.checked
    )
  }

  private async deleteBranches(branches: ReadonlyArray<ICleanupBranch>) {
    const names = branches.map(b => b.name)

    this.setState(({ deleting, failures }) => {
      const nextFailures = new Map(failures)
      names.forEach(n => nextFailures.delete(n))
      return {
        deleting: new Set([...deleting, ...names]),
        failures: nextFailures,
      }
    })

    const result = await this.props.dispatcher.deleteCleanupBranches(
      this.props.repository,
      branches,
      { local: true, remote: true }
    )

    if (this.isUnmounted) {
      return
    }

    this.setState(({ deleting, failures }) => {
      const nextDeleting = new Set(deleting)
      names.forEach(n => nextDeleting.delete(n))
      const nextFailures = new Map(failures)
      result.failures.forEach(f => nextFailures.set(f.name, f.error))
      return { deleting: nextDeleting, failures: nextFailures }
    })
  }

  private onDelete = (branch: ICleanupBranch) => {
    this.deleteBranches([branch])
  }

  private onDeleteAll = () => {
    this.deleteBranches(
      this.props.merged.branches.filter(b => !this.state.deleting.has(b.name))
    )
  }

  public render() {
    const { merged, integrationBranchName } = this.props

    return (
      <div className="hotflow-forgotten hotflow-merged">
        <h3 className="hotflow-summary-heading">Merged branches to delete</h3>
        <Checkbox
          value={merged.autoDelete ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onAutoDeleteChanged}
          label={`Delete my branches automatically once they are merged to ${integrationBranchName}`}
        />
        {merged.autoDelete && (
          <div className="hotflow-summary-empty">
            Deletes the local and remote copy of a branch that has had a pull
            request, on each refresh. It cannot be undone from here.
          </div>
        )}
        {this.renderBody()}
      </div>
    )
  }

  private renderBody() {
    const { merged, integrationBranchName } = this.props
    const { deleting, failures } = this.state

    if (merged.status === 'error' && merged.branches.length === 0) {
      return (
        <div className="hotflow-summary-empty">
          Could not look for merged branches: {merged.errorMessage}
        </div>
      )
    }

    if (merged.branches.length === 0) {
      return (
        <div className="hotflow-summary-empty">
          {merged.status === 'ok'
            ? `✓ None of your branches merged to ${integrationBranchName} are older than ${CleanupMinAgeDays} days.`
            : 'Looking for merged branches…'}
        </div>
      )
    }

    return (
      <>
        <div className="hotflow-summary-empty">
          Your branches already in {integrationBranchName}, last touched{' '}
          {CleanupMinAgeDays} days ago or more.
        </div>
        <ul className="hotflow-forgotten-list">
          {merged.branches.map(b => (
            <MergedBranchRow
              key={b.name}
              branch={b}
              isDeleting={deleting.has(b.name)}
              error={failures.get(b.name) ?? null}
              onDelete={this.onDelete}
            />
          ))}
        </ul>
        {merged.branches.length > 1 && (
          <div className="hotflow-forgotten-actions">
            <Button onClick={this.onDeleteAll}>
              Delete all {merged.branches.length}
            </Button>
          </div>
        )}
      </>
    )
  }
}
