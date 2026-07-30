import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import {
  ApprovalsForReady,
  IPullRequestApproval,
} from '../../../models/hotflow'
import { Dialog, DialogContent, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { Select } from '../../lib/select'
import { Checkbox, CheckboxValue } from '../../lib/checkbox'
import { Ref } from '../../lib/ref'
import { LinkButton } from '../../lib/link-button'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'

/** The merge strategies GitHub offers. */
export type MergeMethod = 'merge' | 'squash' | 'rebase'

interface IMergePullRequestDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher

  readonly pullRequestNumber: number
  readonly branchName: string
  readonly baseBranchName: string
  readonly title: string

  /** The pull request's head sha, so the merge can't hit a moved branch. */
  readonly headSha: string

  /** Link to the pull request, for reading the review before merging. */
  readonly pullRequestUrl: string | null

  /** Null when reviews couldn't be read — not the same as no approvals. */
  readonly approval: IPullRequestApproval | null

  /** The method used last in this repository. */
  readonly initialMergeMethod: MergeMethod

  readonly onDismissed: () => void
}

interface IMergePullRequestDialogState {
  readonly mergeMethod: MergeMethod

  /** Ticked to proceed when the approval count is short. */
  readonly acknowledgedShortfall: boolean

  readonly isMerging: boolean
}

/**
 * Merge a pull request into the integration branch.
 *
 * The second action in HotFlow that reaches outside the repository, and the only
 * one that can't be undone locally: it closes the pull request and notifies its
 * reviewers. GitHub still enforces branch protection server-side, so this can't
 * bypass required checks or reviews — the gate here is about not merging
 * *without looking*, which protection can't help with.
 */
export class MergePullRequestDialog extends React.Component<
  IMergePullRequestDialogProps,
  IMergePullRequestDialogState
> {
  public constructor(props: IMergePullRequestDialogProps) {
    super(props)
    this.state = {
      mergeMethod: props.initialMergeMethod,
      acknowledgedShortfall: false,
      isMerging: false,
    }
  }

  /** True when approvals are known and short of the bar. */
  private get isShortOfApprovals(): boolean {
    const { approval } = this.props

    return approval === null || approval.approvals < ApprovalsForReady
  }

  private get hasChangesRequested(): boolean {
    return (this.props.approval?.changesRequested ?? 0) > 0
  }

  public render() {
    const { pullRequestNumber } = this.props

    const needsAcknowledgement = this.isShortOfApprovals
    const disabled =
      this.state.isMerging ||
      (needsAcknowledgement && !this.state.acknowledgedShortfall)

    return (
      <Dialog
        id="hotflow-merge-pull-request"
        title={
          __DARWIN__
            ? `Merge Pull Request #${pullRequestNumber}`
            : `Merge pull request #${pullRequestNumber}`
        }
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isMerging}
        type={needsAcknowledgement ? 'warning' : 'normal'}
      >
        <DialogContent>
          <p className="hotflow-dialog-lede">
            Merges <Ref>{this.props.branchName}</Ref> into{' '}
            <Ref>{this.props.baseBranchName}</Ref>.
          </p>

          <div className="hotflow-pr-summary">
            <span className="hotflow-pr-title">{this.props.title}</span>
            {this.props.pullRequestUrl !== null && (
              <LinkButton uri={this.props.pullRequestUrl}>
                {`Review #${pullRequestNumber} on GitHub`}
              </LinkButton>
            )}
          </div>

          {this.renderApprovalState()}

          <Select
            label="Merge method"
            value={this.state.mergeMethod}
            onChange={this.onMergeMethodChanged}
          >
            <option value="merge">Create a merge commit</option>
            <option value="squash">Squash and merge</option>
            <option value="rebase">Rebase and merge</option>
          </Select>

          {needsAcknowledgement && (
            <div className="hotflow-mergeback">
              <Checkbox
                label={this.getAcknowledgementLabel()}
                value={
                  this.state.acknowledgedShortfall
                    ? CheckboxValue.On
                    : CheckboxValue.Off
                }
                onChange={this.onAcknowledgedChanged}
              />
              <div className="hotflow-mergeback-why">
                Merging closes the pull request and notifies its reviewers. It
                can't be undone from here.
              </div>
            </div>
          )}

          <p className="hotflow-dialog-note">
            GitHub still enforces branch protection, so a merge that isn't
            allowed will be refused rather than forced.
          </p>
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            destructive={needsAcknowledgement}
            okButtonText={
              __DARWIN__
                ? `Merge #${pullRequestNumber}`
                : `Merge #${pullRequestNumber}`
            }
            okButtonDisabled={disabled}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  /** Why the confirmation is being asked for, in its own words. */
  private getAcknowledgementLabel(): string {
    const { approval } = this.props

    if (approval === null) {
      return "Merge without knowing the review state — reviews couldn't be read"
    }

    if (this.hasChangesRequested) {
      return 'Merge even though a reviewer has requested changes'
    }

    return approval.approvals === 0
      ? 'Merge with no approvals'
      : `Merge with only ${approval.approvals} of ${ApprovalsForReady} approvals`
  }

  private renderApprovalState() {
    const { approval } = this.props

    if (approval === null) {
      return (
        <ul className="hotflow-preflight">
          <li className="hotflow-check warn">
            <Octicon symbol={octicons.alert} />
            <span className="hotflow-check-body">
              <span className="hotflow-check-label">Review state unknown</span>
              <span className="hotflow-check-detail">
                Reviews couldn't be read for this pull request.
              </span>
            </span>
          </li>
        </ul>
      )
    }

    const ready = approval.approvals >= ApprovalsForReady

    return (
      <ul className="hotflow-preflight">
        <li className={`hotflow-check ${ready ? 'pass' : 'warn'}`}>
          <Octicon symbol={ready ? octicons.checkCircle : octicons.alert} />
          <span className="hotflow-check-body">
            <span className="hotflow-check-label">
              {`${approval.approvals} of ${ApprovalsForReady} approvals`}
            </span>
            {!ready && (
              <span className="hotflow-check-detail">
                {`${ApprovalsForReady} approvals is the bar for this to read as ready.`}
              </span>
            )}
          </span>
        </li>

        {this.hasChangesRequested && (
          <li className="hotflow-check fail">
            <Octicon symbol={octicons.xCircle} />
            <span className="hotflow-check-body">
              <span className="hotflow-check-label">
                {`${approval.changesRequested} reviewer${
                  approval.changesRequested === 1 ? '' : 's'
                } requested changes`}
              </span>
            </span>
          </li>
        )}
      </ul>
    )
  }

  private onMergeMethodChanged = (
    event: React.FormEvent<HTMLSelectElement>
  ) => {
    this.setState({ mergeMethod: event.currentTarget.value as MergeMethod })
  }

  private onAcknowledgedChanged = (
    event: React.FormEvent<HTMLInputElement>
  ) => {
    this.setState({ acknowledgedShortfall: event.currentTarget.checked })
  }

  private onSubmit = async () => {
    this.setState({ isMerging: true })

    await this.props.dispatcher.mergeHotFlowPullRequest(
      this.props.repository,
      this.props.pullRequestNumber,
      this.state.mergeMethod,
      this.props.headSha
    )

    this.props.onDismissed()
  }
}
