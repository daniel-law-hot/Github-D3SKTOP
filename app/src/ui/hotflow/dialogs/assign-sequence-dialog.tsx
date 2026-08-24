import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Checkbox, CheckboxValue } from '../../lib/checkbox'
import { IHotFlowState } from '../../../models/hotflow'
import {
  getOverwriteReleaseSequence,
  setOverwriteReleaseSequence,
} from '../../../lib/hotflow/settings-store'

interface IAssignSequenceDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly hotFlowState: IHotFlowState
  readonly onDismissed: () => void
}

interface IAssignSequenceDialogState {
  readonly overwrite: boolean
  readonly isSaving: boolean
}

/**
 * Confirm writing the Release sequence number to work items that lack it.
 *
 * The one write HotFlow makes to Azure DevOps, so it asks first. Not because a
 * confirmation step is inherently worth its cost — most aren't — but because this
 * one carries a decision: whether work items already belonging to another release
 * get moved into this one. That is not a thing to discover afterwards.
 *
 * The two numbers are the whole content. What will be set, and what will be left
 * alone or overwritten depending on the box.
 */
export class AssignSequenceDialog extends React.Component<
  IAssignSequenceDialogProps,
  IAssignSequenceDialogState
> {
  public constructor(props: IAssignSequenceDialogProps) {
    super(props)

    this.state = {
      // Comes back the way it was left, which is the point of remembering it.
      overwrite: getOverwriteReleaseSequence(props.repository),
      isSaving: false,
    }
  }

  private get sequence(): number | null {
    return (
      this.props.hotFlowState.currentRelease?.releaseSequence?.value ?? null
    )
  }

  /**
   * The work items in this release that aren't assigned to it, split by whether
   * they have a sequence number at all.
   *
   * Computed from the same two lists the reconciliation compares, so these
   * numbers and the figure that was clicked to get here cannot disagree.
   */
  private get unassigned(): {
    readonly empty: ReadonlyArray<number>
    readonly elsewhere: ReadonlyArray<{ id: number; sequence: number }>
  } {
    const { hotFlowState } = this.props
    const release = hotFlowState.currentRelease

    if (release === null) {
      return { empty: [], elsewhere: [] }
    }

    const assigned = new Set(hotFlowState.ado.sequenceAssignedIds)
    const empty: Array<number> = []
    const elsewhere: Array<{ id: number; sequence: number }> = []

    for (const id of release.vsoNumbers) {
      if (assigned.has(id)) {
        continue
      }

      const existing =
        hotFlowState.ado.workItems.get(id)?.releaseSequence ?? null

      if (existing === null) {
        empty.push(id)
      } else {
        elsewhere.push({ id, sequence: existing })
      }
    }

    return { empty, elsewhere }
  }

  public render() {
    const sequence = this.sequence
    const { empty, elsewhere } = this.unassigned
    const total = empty.length + (this.state.overwrite ? elsewhere.length : 0)

    return (
      <Dialog
        id="hotflow-assign-sequence"
        title={
          __DARWIN__
            ? 'Assign Release Sequence Number'
            : 'Assign release sequence number'
        }
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isSaving}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            {sequence === null ? (
              <>
                This release has no sequence number, so there is nothing to
                assign.
              </>
            ) : (
              <>
                Set the "Release sequence number" field to{' '}
                <span className="num">{sequence}</span> on work items that are
                in this release without being assigned to it.
              </>
            )}
          </p>

          <dl className="hotflow-dl">
            <dt>No sequence number</dt>
            <dd className="num">{empty.length}</dd>

            <dt>Assigned to another release</dt>
            <dd className="num">{elsewhere.length}</dd>
          </dl>

          {elsewhere.length > 0 && (
            <Checkbox
              label="Also reassign work items that belong to another release"
              value={
                this.state.overwrite ? CheckboxValue.On : CheckboxValue.Off
              }
              onChange={this.onOverwriteChanged}
            />
          )}

          {this.renderNote(elsewhere)}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText={
              total === 0
                ? 'Assign'
                : `Assign ${total} work ${total === 1 ? 'item' : 'items'}`
            }
            okButtonDisabled={
              total === 0 || sequence === null || this.state.isSaving
            }
            destructive={this.state.overwrite && elsewhere.length > 0}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  /**
   * What the box means, in terms of the work items it affects.
   *
   * Names them when there are few enough to name. A number is enough to decide
   * with when the answer is "leave them alone", but overwriting is worth seeing
   * the actual releases you would be taking work out of.
   */
  private renderNote(
    elsewhere: ReadonlyArray<{ id: number; sequence: number }>
  ) {
    if (elsewhere.length === 0) {
      return (
        <p className="hotflow-dialog-note">
          Nothing here belongs to another release, so nothing can be taken from
          one.
        </p>
      )
    }

    const shown = elsewhere.slice(0, 4)

    const rest =
      elsewhere.length > 4 ? `, and ${elsewhere.length - 4} more` : ''

    // Two different arrows. Left alone, the interesting number is the one each
    // item already carries; overwritten, it's the one they would all end up with
    // — so the line reads as what will change rather than what is.
    const named = shown
      .map(
        e =>
          `${e.id} → ${
            this.state.overwrite ? this.sequence ?? e.sequence : e.sequence
          }`
      )
      .join(', ')

    return (
      <p className="hotflow-dialog-note">
        {this.state.overwrite
          ? `These will be updated to: ${named}${rest}.`
          : `These stay where they are: ${named}${rest}.`}
      </p>
    )
  }

  private onOverwriteChanged = (
    event: React.FormEvent<HTMLInputElement>
  ): void => {
    this.setState({ overwrite: event.currentTarget.checked })
  }

  private onSubmit = async () => {
    const { repository, dispatcher } = this.props
    const { overwrite } = this.state

    this.setState({ isSaving: true })

    // Remembered whether or not Azure DevOps accepts the writes — the choice was
    // made either way, and having to make it again after a failed run is the
    // annoyance this is meant to remove.
    setOverwriteReleaseSequence(repository, overwrite)

    // Dismissed before the run rather than after. The result lands on the summary
    // panel, which is where the numbers it changes are, and holding a dialog open
    // over the thing it is updating hides the answer.
    this.props.onDismissed()

    await dispatcher.assignReleaseSequenceToMerged(repository, overwrite)
  }
}
