import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { ICleanupResult } from '../../../models/hotflow'
import {
  CleanupMinAgeDays,
  ICleanupBranch,
} from '../../../lib/hotflow/branch-cleanup'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Checkbox, CheckboxValue } from '../../lib/checkbox'
import { Ref } from '../../lib/ref'
import { RelativeTime } from '../../relative-time'
import { TooltippedContent } from '../../lib/tooltipped-content'

interface ICleanupBranchesDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

interface ICleanupBranchesDialogState {
  /** Null while they are being looked for. */
  readonly branches: ReadonlyArray<ICleanupBranch> | null
  readonly selected: ReadonlySet<string>
  readonly deleteLocal: boolean
  readonly deleteRemote: boolean
  readonly isDeleting: boolean
  readonly progress: { readonly done: number; readonly total: number } | null

  /** Set once a deletion has finished with something left to read. */
  readonly result: ICleanupResult | null
  readonly errorMessage: string | null
}

/**
 * One row, as its own component so its checkbox handler is bound rather than made
 * fresh on every render of a list that can be long.
 */
interface ICleanupRowProps {
  readonly branch: ICleanupBranch
  readonly checked: boolean
  readonly disabled: boolean
  readonly onToggled: (name: string, checked: boolean) => void
}

class CleanupRow extends React.Component<ICleanupRowProps> {
  private onChange = (event: React.FormEvent<HTMLInputElement>) => {
    this.props.onToggled(this.props.branch.name, event.currentTarget.checked)
  }

  public render() {
    const { branch, checked, disabled } = this.props

    return (
      <li className="hotflow-cleanup-row">
        <Checkbox
          value={checked ? CheckboxValue.On : CheckboxValue.Off}
          onChange={this.onChange}
          disabled={disabled}
          label={
            <span className="hotflow-cleanup-label">
              <TooltippedContent
                className="mono hotflow-cleanup-name"
                tooltip={branch.name}
              >
                {branch.name}
              </TooltippedContent>
              <span className="hotflow-cleanup-meta">
                {branch.local !== null && (
                  <span className="hotflow-cleanup-where">local</span>
                )}
                {branch.remote !== null && (
                  <span className="hotflow-cleanup-where">remote</span>
                )}
                <RelativeTime
                  date={new Date(branch.lastCommitAt)}
                  onlyRelative={true}
                />
              </span>
            </span>
          }
        />
      </li>
    )
  }
}

/**
 * Clears out the user's old branches that are already in develop and a release.
 *
 * Everything listed is merged into both, so deleting a branch loses no work. The
 * ones left alone for two weeks are ticked to start with; younger ones are listed
 * but not ticked, in case someone wants them gone early. Nothing is deleted until
 * the button, which says how many.
 */
export class CleanupBranchesDialog extends React.Component<
  ICleanupBranchesDialogProps,
  ICleanupBranchesDialogState
> {
  private isUnmounted = false

  public constructor(props: ICleanupBranchesDialogProps) {
    super(props)
    this.state = {
      branches: null,
      selected: new Set<string>(),
      deleteLocal: true,
      deleteRemote: true,
      isDeleting: false,
      progress: null,
      result: null,
      errorMessage: null,
    }
  }

  public componentDidMount() {
    this.load()
  }

  public componentWillUnmount() {
    this.isUnmounted = true
  }

  private async load() {
    try {
      const branches = await this.props.dispatcher.findCleanupBranches(
        this.props.repository
      )

      if (this.isUnmounted) {
        return
      }

      this.setState({
        branches,
        selected: new Set(branches.filter(b => b.preselected).map(b => b.name)),
      })
    } catch (e) {
      if (!this.isUnmounted) {
        this.setState({
          branches: [],
          errorMessage: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  /** The chosen branches that the chosen options would actually touch. */
  private get affected(): ReadonlyArray<ICleanupBranch> {
    const { branches, selected, deleteLocal, deleteRemote } = this.state

    return (branches ?? []).filter(
      b =>
        selected.has(b.name) &&
        ((deleteLocal && b.local !== null) ||
          (deleteRemote && b.remote !== null))
    )
  }

  private onToggled = (name: string, checked: boolean) => {
    const selected = new Set(this.state.selected)

    if (checked) {
      selected.add(name)
    } else {
      selected.delete(name)
    }

    this.setState({ selected })
  }

  private onSelectAllChanged = (event: React.FormEvent<HTMLInputElement>) => {
    const all = event.currentTarget.checked

    this.setState({
      selected: new Set(
        all ? (this.state.branches ?? []).map(b => b.name) : []
      ),
    })
  }

  private onDeleteLocalChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ deleteLocal: event.currentTarget.checked })
  }

  private onDeleteRemoteChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.setState({ deleteRemote: event.currentTarget.checked })
  }

  private onProgress = (done: number, total: number) => {
    if (!this.isUnmounted) {
      this.setState({ progress: { done, total } })
    }
  }

  private onSubmit = async () => {
    // After a run that left failures the button only closes the dialog.
    if (this.state.result !== null) {
      this.props.onDismissed()
      return
    }

    const targets = this.affected

    if (targets.length === 0 || this.state.isDeleting) {
      return
    }

    this.setState({
      isDeleting: true,
      progress: { done: 0, total: targets.length },
    })

    const result = await this.props.dispatcher.deleteCleanupBranches(
      this.props.repository,
      targets,
      { local: this.state.deleteLocal, remote: this.state.deleteRemote },
      this.onProgress
    )

    if (this.isUnmounted) {
      return
    }

    // Everything went: nothing left to read, so the dialog has done its job.
    if (result.failures.length === 0) {
      this.props.onDismissed()
      return
    }

    // Some did not. Drop the ones that went from the list and show the rest.
    const gone = new Set(result.deleted)

    this.setState({
      isDeleting: false,
      progress: null,
      result,
      branches: (this.state.branches ?? []).filter(b => !gone.has(b.name)),
    })
  }

  private renderList(branches: ReadonlyArray<ICleanupBranch>) {
    const { selected, isDeleting } = this.state
    const selectedCount = branches.filter(b => selected.has(b.name)).length

    return (
      <>
        <Checkbox
          className="hotflow-cleanup-all"
          value={
            selectedCount === 0
              ? CheckboxValue.Off
              : selectedCount === branches.length
              ? CheckboxValue.On
              : CheckboxValue.Mixed
          }
          onChange={this.onSelectAllChanged}
          disabled={isDeleting}
          label={`${selectedCount} of ${branches.length} selected`}
        />
        <ul className="hotflow-cleanup-list">
          {branches.map(b => (
            <CleanupRow
              key={b.name}
              branch={b}
              checked={selected.has(b.name)}
              disabled={isDeleting}
              onToggled={this.onToggled}
            />
          ))}
        </ul>
      </>
    )
  }

  private renderFailures(result: ICleanupResult) {
    return (
      <div className="hotflow-cleanup-failures" role="alert">
        <strong>
          {result.deleted.length} deleted,{' '}
          {result.failures.length === 1
            ? '1 could not be'
            : `${result.failures.length} could not be`}
          .
        </strong>
        <ul>
          {result.failures.map(f => (
            <li key={f.name}>
              <Ref>{f.name}</Ref> — {f.error}
            </li>
          ))}
        </ul>
      </div>
    )
  }

  private renderBody() {
    const { branches, errorMessage } = this.state

    if (errorMessage !== null) {
      return (
        <p className="hotflow-dialog-note">
          Could not look for your branches: {errorMessage}
        </p>
      )
    }

    if (branches === null) {
      return <p className="hotflow-dialog-note">Looking for your branches…</p>
    }

    if (branches.length === 0) {
      return (
        <p className="hotflow-dialog-note">
          Nothing to clean up. None of your branches are merged into develop and
          a release yet.
        </p>
      )
    }

    return this.renderList(branches)
  }

  public render() {
    const { branches, isDeleting, progress, result } = this.state
    const count = this.affected.length
    const hasList = branches !== null && branches.length > 0

    return (
      <Dialog
        id="hotflow-cleanup-branches"
        title={__DARWIN__ ? 'Clean Up Old Branches' : 'Clean up old branches'}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={isDeleting || branches === null}
        type={hasList ? 'warning' : 'normal'}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            Your branches that are already in develop and a release. Anything
            last touched {CleanupMinAgeDays} days ago or more is selected.
          </p>

          {this.renderBody()}

          {hasList && (
            <div className="hotflow-cleanup-options">
              <Checkbox
                value={
                  this.state.deleteLocal ? CheckboxValue.On : CheckboxValue.Off
                }
                onChange={this.onDeleteLocalChanged}
                disabled={isDeleting}
                label="Delete the local copy"
              />
              <Checkbox
                value={
                  this.state.deleteRemote ? CheckboxValue.On : CheckboxValue.Off
                }
                onChange={this.onDeleteRemoteChanged}
                disabled={isDeleting}
                label="Delete the remote copy"
              />
            </div>
          )}

          {result !== null && this.renderFailures(result)}

          {hasList && (
            <p className="hotflow-dialog-note">
              Nothing on these branches is lost: it is all in develop and a
              release already. Deleting from the remote can't be undone from
              here.
            </p>
          )}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            destructive={result === null && hasList}
            okButtonText={
              result !== null
                ? 'Close'
                : isDeleting && progress !== null
                ? `Deleting ${progress.done} of ${progress.total}…`
                : `Delete ${count} ${count === 1 ? 'branch' : 'branches'}`
            }
            okButtonDisabled={
              result === null && (!hasList || count === 0 || isDeleting)
            }
            cancelButtonVisible={result === null}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
