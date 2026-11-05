import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { IHotFlowState } from '../../../models/hotflow'
import { IRepositoryPipeline } from '../../../lib/hotflow/ado-pipelines'
import { PipelineSource } from '../../../lib/hotflow/pipeline-overrides'
import { getPipelineOverrides } from '../../../lib/hotflow/pipeline-overrides-store'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Button } from '../../lib/button'
import { TextBox } from '../../lib/text-box'

interface IEditPipelinesDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly hotFlowState: IHotFlowState
  readonly onDismissed: () => void
}

interface IEditPipelinesDialogState {
  readonly text: string
  readonly isAdding: boolean
  readonly errorMessage: string | null

  /** The pipeline being hidden or restored, so its button can say so. */
  readonly busyId: number | null
}

interface IPipelineRowProps {
  readonly id: number
  readonly name: string
  readonly note: string
  readonly actionLabel: string
  readonly disabled: boolean
  readonly onAction: (id: number) => void
}

/** One pipeline in either list, as its own component so its button is bound. */
class PipelineRow extends React.Component<IPipelineRowProps> {
  private onClick = () => {
    this.props.onAction(this.props.id)
  }

  public render() {
    const { id, name, note, actionLabel, disabled } = this.props

    return (
      <li className="hotflow-pipelines-row">
        <span className="hotflow-pipelines-name">
          <span>{name}</span>
          <span className="hotflow-pipelines-note">
            #{id} · {note}
          </span>
        </span>
        <Button onClick={this.onClick} disabled={disabled}>
          {actionLabel}
        </Button>
      </li>
    )
  }
}

/**
 * Says which release pipelines HotFlow shows for a repository, for when the
 * automatic lookup gets it wrong.
 *
 * The lookup finds a repository's pipelines through its builds. For a repository
 * that builds several apps (HOTWebsites builds RetailB2B, MixAndMatch, HOBT…) that
 * can miss one or find one that belongs to something else. Here a pipeline can be
 * added by pasting its address from Azure DevOps, one found automatically can be
 * hidden, and a hidden one can be brought back. Kept per repository.
 */
export class EditPipelinesDialog extends React.Component<
  IEditPipelinesDialogProps,
  IEditPipelinesDialogState
> {
  public constructor(props: IEditPipelinesDialogProps) {
    super(props)
    this.state = { text: '', isAdding: false, errorMessage: null, busyId: null }
  }

  private onTextChanged = (text: string) => {
    this.setState({ text, errorMessage: null })
  }

  private onSubmit = async () => {
    const text = this.state.text.trim()

    // Enter on an empty box is the way out, like any other dialog's.
    if (text.length === 0) {
      this.props.onDismissed()
      return
    }

    await this.add(text)
  }

  private onAddClicked = () => {
    const text = this.state.text.trim()

    if (text.length > 0) {
      this.add(text)
    }
  }

  private async add(text: string) {
    if (this.state.isAdding) {
      return
    }

    this.setState({ isAdding: true, errorMessage: null })

    const error = await this.props.dispatcher.addHotFlowPipeline(
      this.props.repository,
      text
    )

    this.setState({
      isAdding: false,
      errorMessage: error,
      // Kept when it failed, so a typo is fixed rather than retyped.
      text: error === null ? '' : this.state.text,
    })
  }

  private onRemove = async (id: number) => {
    const pipeline = this.props.hotFlowState.pipeline.pipelines.find(
      p => p.definitionId === id
    )

    if (pipeline === undefined) {
      return
    }

    this.setState({ busyId: id })
    await this.props.dispatcher.removeHotFlowPipeline(
      this.props.repository,
      id,
      pipeline.name,
      pipeline.source ?? 'found'
    )
    this.setState({ busyId: null })
  }

  private onRestore = async (id: number) => {
    this.setState({ busyId: id })
    await this.props.dispatcher.restoreHotFlowPipeline(
      this.props.repository,
      id
    )
    this.setState({ busyId: null })
  }

  private describe(source: PipelineSource): string {
    return source === 'added' ? 'added by you' : 'found automatically'
  }

  private renderCurrent(pipelines: ReadonlyArray<IRepositoryPipeline>) {
    if (pipelines.length === 0) {
      return (
        <p className="hotflow-dialog-note">
          No release pipeline is showing for this repository.
        </p>
      )
    }

    return (
      <ul className="hotflow-pipelines-list">
        {pipelines.map(p => {
          const source = p.source ?? 'found'

          return (
            <PipelineRow
              key={p.definitionId}
              id={p.definitionId}
              name={p.name}
              note={this.describe(source)}
              actionLabel={source === 'added' ? 'Remove' : 'Hide'}
              disabled={this.state.busyId !== null}
              onAction={this.onRemove}
            />
          )
        })}
      </ul>
    )
  }

  public render() {
    const { repository, hotFlowState } = this.props
    const { text, isAdding, errorMessage } = this.state
    const hidden = getPipelineOverrides(repository).hidden

    return (
      <Dialog
        id="hotflow-edit-pipelines"
        title={__DARWIN__ ? 'Release Pipelines' : 'Release pipelines'}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={isAdding}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            HotFlow finds {repository.alias ?? repository.name}'s release
            pipelines through its Azure DevOps builds. If one is missing, or one
            doesn't belong, say so here.
          </p>

          <h3 className="hotflow-dialog-heading">Showing</h3>
          {this.renderCurrent(hotFlowState.pipeline.pipelines)}

          {hidden.length > 0 && (
            <>
              <h3 className="hotflow-dialog-heading">Hidden</h3>
              <ul className="hotflow-pipelines-list">
                {hidden.map(h => (
                  <PipelineRow
                    key={h.id}
                    id={h.id}
                    name={h.name}
                    note="hidden"
                    actionLabel="Show again"
                    disabled={this.state.busyId !== null}
                    onAction={this.onRestore}
                  />
                ))}
              </ul>
            </>
          )}

          <h3 className="hotflow-dialog-heading">Add a pipeline</h3>
          <div className="hotflow-pipelines-add">
            <TextBox
              value={text}
              placeholder="Release address or id"
              ariaLabel="Release pipeline address or id"
              onValueChanged={this.onTextChanged}
              disabled={isAdding}
            />
            <Button
              onClick={this.onAddClicked}
              disabled={isAdding || text.trim() === ''}
            >
              Add
            </Button>
          </div>
          {errorMessage !== null && (
            <p className="hotflow-pipelines-error" role="alert">
              {errorMessage}
            </p>
          )}
          <p className="hotflow-dialog-note">
            Open the pipeline in Azure DevOps (Pipelines, Releases) and paste
            the address from the browser, which ends in{' '}
            <code>definitionId=165</code>. The number alone works too.
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Done"
            cancelButtonVisible={false}
            okButtonDisabled={isAdding}
          />
        </DialogFooter>
      </Dialog>
    )
  }
}
