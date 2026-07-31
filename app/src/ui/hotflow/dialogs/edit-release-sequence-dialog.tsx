import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { TextBox } from '../../lib/text-box'
import { Ref } from '../../lib/ref'
import { LinkButton } from '../../lib/link-button'
import { parseReleaseSequence } from '../../../lib/hotflow/release-sequence'

interface IEditReleaseSequenceDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly branchName: string

  /** The number in effect now, derived or overridden. Seeds the form. */
  readonly currentSequence: number | null

  /** What the version gives, so this can offer to go back to it. */
  readonly derivedSequence: number | null

  readonly onDismissed: () => void
}

interface IEditReleaseSequenceDialogState {
  readonly value: string
  readonly isSaving: boolean
}

/**
 * Change the Azure DevOps release sequence number a release branch queries.
 *
 * HotFlow derives it from the version — `1.2026.17` gives 202617 — and shows it on
 * the release summary, where clicking it opens this. One field, taking the number
 * exactly as it appears in a work item's Details, because that's what people read
 * it off. No year and cycle boxes to assemble it from: the assembling is what the
 * derivation already does, and getting here at all means the derivation was wrong.
 */
export class EditReleaseSequenceDialog extends React.Component<
  IEditReleaseSequenceDialogProps,
  IEditReleaseSequenceDialogState
> {
  public constructor(props: IEditReleaseSequenceDialogProps) {
    super(props)

    this.state = {
      value: props.currentSequence?.toString() ?? '',
      isSaving: false,
    }
  }

  /** The typed value, or null when it isn't a usable sequence number. */
  private get sequence(): number | null {
    const numeric = parseInt(this.state.value, 10)

    if (!Number.isInteger(numeric)) {
      return null
    }

    // Round-trip through the parser so this can only ever produce a number the
    // rest of HotFlow will accept.
    return parseReleaseSequence(numeric) !== null ? numeric : null
  }

  public render() {
    const sequence = this.sequence
    const parsed = sequence === null ? null : parseReleaseSequence(sequence)

    return (
      <Dialog
        id="hotflow-edit-release-sequence"
        title={
          __DARWIN__
            ? 'Set Release Sequence Number'
            : 'Set release sequence number'
        }
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isSaving}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            Which release sequence number should{' '}
            <Ref>{this.props.branchName}</Ref> reconcile against? Work items
            whose "Release sequence number" matches are compared with what's
            actually in the release.
          </p>

          <TextBox
            label="Release sequence number"
            value={this.state.value}
            onValueChanged={this.onValueChanged}
            placeholder="202617"
            autoFocus={true}
          />

          <div className="hotflow-name-preview">
            <span className="hotflow-name-preview-label">Reads as</span>
            <span className="hotflow-name-preview-value">
              {parsed === null
                ? '—'
                : `cycle ${parsed.cycle} of ${parsed.year}`}
            </span>
          </div>

          {this.renderDerivedHint()}

          <p className="hotflow-dialog-note">
            Remembered for this branch. The next release branch goes back to
            using its version.
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Save"
            okButtonDisabled={sequence === null || this.state.isSaving}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  /**
   * What the version gives, with a way back to it.
   *
   * Only shown once the field has been changed away from it — otherwise it would
   * be offering to set the value it already holds.
   */
  private renderDerivedHint() {
    const { derivedSequence } = this.props

    if (derivedSequence === null) {
      return (
        <p className="hotflow-dialog-note">
          The version doesn't give a year and cycle to derive a number from, so
          there's nothing to fall back to.
        </p>
      )
    }

    if (this.sequence === derivedSequence) {
      return null
    }

    return (
      <p className="hotflow-dialog-note">
        The version gives <span className="num">{derivedSequence}</span>.{' '}
        <LinkButton onClick={this.onUseDerived}>Use that instead</LinkButton>
      </p>
    )
  }

  private onUseDerived = () => {
    this.setState({ value: this.props.derivedSequence?.toString() ?? '' })
  }

  private onValueChanged = (value: string) => {
    this.setState({ value: value.replace(/[^0-9]/g, '') })
  }

  private onSubmit = async () => {
    const sequence = this.sequence

    if (sequence === null) {
      return
    }

    this.setState({ isSaving: true })

    await this.props.dispatcher.setReleaseSequence(
      this.props.repository,
      this.props.branchName,
      sequence
    )

    this.props.onDismissed()
  }
}
