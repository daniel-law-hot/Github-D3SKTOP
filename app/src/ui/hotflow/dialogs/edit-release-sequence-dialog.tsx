import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { TextBox } from '../../lib/text-box'
import { Ref } from '../../lib/ref'
import { LinkButton } from '../../lib/link-button'
import { parseReleaseSequence } from '../../../lib/hotflow/release-sequence'
import { Checkbox, CheckboxValue } from '../../lib/checkbox'

interface IEditReleaseSequenceDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly branchName: string

  /** The number in effect now, derived or overridden. Seeds the form. */
  readonly currentSequence: number | null

  /** What the version gives, so this can offer to go back to it. */
  readonly derivedSequence: number | null

  /** Whether this repository currently hides assigned-but-not-merged items. */
  readonly suppressAssignedNotMerged: boolean

  readonly onDismissed: () => void
}

interface IEditReleaseSequenceDialogState {
  readonly value: string
  readonly suppressAssignedNotMerged: boolean
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
      suppressAssignedNotMerged: props.suppressAssignedNotMerged,
      isSaving: false,
    }
  }

  /** True when the field has been emptied, meaning "this release has none". */
  private get isCleared(): boolean {
    return this.state.value.trim().length === 0
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
            actually in the release. Leave it empty if this release doesn't have
            one.
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
              {this.isCleared
                ? 'no sequence — nothing to reconcile against'
                : parsed === null
                ? '—'
                : `cycle ${parsed.cycle} of ${parsed.year}`}
            </span>
          </div>

          {this.isCleared ? (
            <p className="hotflow-dialog-note">
              Leaving this empty is for a release that doesn't follow the
              Content Orchestration cycle. Nothing is compared against Azure
              DevOps, so work items are neither reported as assigned nor as
              missing — they simply show as merged.
            </p>
          ) : (
            this.renderDerivedHint()
          )}

          <Checkbox
            label="Don't look for work items assigned to a release but not merged into it"
            value={
              this.state.suppressAssignedNotMerged
                ? CheckboxValue.On
                : CheckboxValue.Off
            }
            onChange={this.onSuppressChanged}
          />

          <p className="hotflow-dialog-note">
            The sequence number is remembered for this branch; the next release
            branch goes back to using its version. The checkbox is for the whole
            repository, since it describes how this repository relates to the
            cycle rather than anything about one release.
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Save"
            okButtonDisabled={
              (!this.isCleared && sequence === null) || this.state.isSaving
            }
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

  private onSuppressChanged = (
    event: React.FormEvent<HTMLInputElement>
  ): void => {
    this.setState({ suppressAssignedNotMerged: event.currentTarget.checked })
  }

  private onSubmit = async () => {
    const sequence = this.sequence

    if (!this.isCleared && sequence === null) {
      return
    }

    this.setState({ isSaving: true })

    const { repository, branchName, dispatcher } = this.props

    // The preference first, so that the refresh each of these triggers reads both
    // changes rather than reconciling once against a half-applied pair.
    if (
      this.state.suppressAssignedNotMerged !==
      this.props.suppressAssignedNotMerged
    ) {
      await dispatcher.setSuppressAssignedNotMerged(
        repository,
        this.state.suppressAssignedNotMerged
      )
    }

    if (this.isCleared) {
      await dispatcher.clearReleaseSequence(repository, branchName)
    } else if (sequence !== null) {
      await dispatcher.setReleaseSequence(repository, branchName, sequence)
    }

    this.props.onDismissed()
  }
}
