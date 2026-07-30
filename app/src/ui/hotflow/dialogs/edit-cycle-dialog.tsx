import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { TextBox } from '../../lib/text-box'
import { Ref } from '../../lib/ref'
import { formatCycleTag, parseCycleTag } from '../../../lib/hotflow/cycle'

interface IEditCycleDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly branchName: string

  /** The current tag, guessed or confirmed. Seeds the form. */
  readonly currentTag: string | null

  readonly onDismissed: () => void
}

interface IEditCycleDialogState {
  readonly year: string
  readonly cycle: string
  readonly isSaving: boolean
}

/**
 * Set which Azure DevOps cycle a release branch belongs to.
 *
 * HotFlow guesses this from the trailing segment of the version number, but that
 * convention varies by repo — so the guess is only ever a starting point, and
 * confirming it here is what makes the "tagged but not merged" list trustworthy
 * rather than provisional.
 */
export class EditCycleDialog extends React.Component<
  IEditCycleDialogProps,
  IEditCycleDialogState
> {
  public constructor(props: IEditCycleDialogProps) {
    super(props)

    const parsed =
      props.currentTag !== null ? parseCycleTag(props.currentTag) : null

    this.state = {
      year: parsed !== null ? parsed.year.toString() : '',
      cycle: parsed !== null ? parsed.cycle.toString() : '',
      isSaving: false,
    }
  }

  private get tag(): string | null {
    const year = parseInt(this.state.year, 10)
    const cycle = parseInt(this.state.cycle, 10)

    if (!Number.isFinite(year) || !Number.isFinite(cycle)) {
      return null
    }

    const candidate = formatCycleTag(year, cycle)

    // Round-trip through the parser so the dialog can only ever produce a tag
    // the rest of HotFlow will accept.
    return parseCycleTag(candidate) !== null ? candidate : null
  }

  public render() {
    const tag = this.tag

    return (
      <Dialog
        id="hotflow-edit-cycle"
        title={__DARWIN__ ? 'Set Release Cycle' : 'Set release cycle'}
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isSaving}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            Which Azure DevOps cycle does <Ref>{this.props.branchName}</Ref>{' '}
            belong to? Work items tagged with this cycle are reconciled against
            what's actually in the release.
          </p>

          <div className="hotflow-cycle-fields">
            <TextBox
              label="Year"
              value={this.state.year}
              onValueChanged={this.onYearChanged}
              placeholder="2026"
              autoFocus={true}
            />
            <TextBox
              label="Cycle"
              value={this.state.cycle}
              onValueChanged={this.onCycleChanged}
              placeholder="9"
            />
          </div>

          <div className="hotflow-name-preview">
            <span className="hotflow-name-preview-label">ADO tag</span>
            <span className="hotflow-name-preview-value mono">
              {tag ?? '—'}
            </span>
          </div>

          <p className="hotflow-dialog-note">
            Remembered for this branch, so you'll only be asked once.
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Save"
            okButtonDisabled={tag === null || this.state.isSaving}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private onYearChanged = (year: string) => {
    this.setState({ year: year.replace(/[^0-9]/g, '') })
  }

  private onCycleChanged = (cycle: string) => {
    this.setState({ cycle: cycle.replace(/[^0-9]/g, '') })
  }

  private onSubmit = async () => {
    const tag = this.tag

    if (tag === null) {
      return
    }

    this.setState({ isSaving: true })

    await this.props.dispatcher.setReleaseCycle(
      this.props.repository,
      this.props.branchName,
      tag
    )

    this.props.onDismissed()
  }
}
