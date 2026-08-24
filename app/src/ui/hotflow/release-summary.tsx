import * as React from 'react'
import {
  IHotFlowState,
  IReconciliation,
  IResolvedBranch,
  IReleaseBranchState,
  IShippedRelease,
} from '../../models/hotflow'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { LinkButton } from '../lib/link-button'
import { RelativeTime } from '../relative-time'
import { TooltippedContent } from '../lib/tooltipped-content'
import { TooltipDirection } from '../lib/tooltip'
import classNames from 'classnames'

interface IReleaseSummaryProps {
  readonly hotFlowState: IHotFlowState
  readonly release: IReleaseBranchState

  /**
   * The whole reconciliation rather than one count from it, because the panel now
   * shows three of its numbers and the button acts on a fourth. Deriving them
   * separately is how they'd drift apart.
   */
  readonly reconciliation: IReconciliation

  readonly onEditReleaseSequence: () => void
  readonly onViewRelease: (release: IReleaseBranchState) => void
  readonly onEditBranches: () => void

  /** Assigns this release's sequence to the merged-but-unassigned work items. */
  readonly onAssignReleaseSequence: () => void

  /** The shipped release being inspected, so its row reads as selected. */
  readonly selectedHistoryTag: string | null

  readonly onSelectHistoryRelease: (release: IShippedRelease) => void
}

/**
 * The right column: the facts about this release, other releases in flight, and
 * what shipped before.
 */
export class ReleaseSummary extends React.Component<IReleaseSummaryProps> {
  private get integrationName(): string {
    return this.props.hotFlowState.integrationBranchName
  }

  private get productionName(): string {
    return this.props.hotFlowState.productionBranchName
  }

  public render() {
    return (
      <aside className="hotflow-summary">
        {this.renderThisRelease()}
        <div className="hotflow-summary-rule" />
        {this.renderPosition()}
        {this.renderAssignmentResult()}
        {this.renderOtherReleases()}
        <div className="hotflow-summary-rule" />
        {this.renderHistory()}
      </aside>
    )
  }

  private renderThisRelease() {
    const { release } = this.props

    return (
      <>
        <h3 className="hotflow-summary-heading">This release</h3>
        <dl className="hotflow-dl">
          <dt>Version</dt>
          <dd className="mono">{release.version.raw}</dd>

          {/* Named as it appears in a work item's Details, because that's where
              you'd go to check it. Clicking it is how you change it. */}
          <dt>Release sequence</dt>
          <dd>{this.renderReleaseSequence()}</dd>

          <dt>Branch</dt>
          <dd className="mono">{release.branch.nameWithoutRemote}</dd>
        </dl>

        <div className="hotflow-summary-rule" />

        {/* Which branches HotFlow resolved. Shown because every number in this
            panel is measured against them — a wrong guess should be visible
            rather than silently skewing everything. */}
        <h3 className="hotflow-summary-heading">
          Flow branches
          <LinkButton
            className="hotflow-summary-heading-action"
            onClick={this.props.onEditBranches}
          >
            Change
          </LinkButton>
        </h3>
        <dl className="hotflow-dl">
          <dt>Integration</dt>
          <dd className="mono">
            {this.integrationName}
            {this.renderResolutionHint(
              this.props.hotFlowState.integrationResolution
            )}
          </dd>

          <dt>Production</dt>
          <dd className="mono">
            {this.productionName}
            {this.renderResolutionHint(
              this.props.hotFlowState.productionResolution
            )}
          </dd>
        </dl>
      </>
    )
  }

  /**
   * A marker when a branch wasn't simply found locally by its conventional name —
   * remote-only, pinned by hand, or taken from the default branch.
   */
  private renderResolutionHint(resolution: IResolvedBranch | null) {
    if (resolution === null) {
      return null
    }

    if (resolution.resolution === 'override') {
      return <span className="hotflow-branch-hint">pinned</span>
    }

    if (resolution.resolution === 'default-branch') {
      return <span className="hotflow-branch-hint">default branch</span>
    }

    if (resolution.remoteOnly) {
      return <span className="hotflow-branch-hint">remote</span>
    }

    return null
  }

  /**
   * The release sequence number, as a link that opens the editor.
   *
   * Derived from the version, so it's shown as a plain fact you can click rather
   * than a guess awaiting confirmation — the number being on screen is the
   * disclosure, and it's right wherever the version's cycle segment is the
   * calendar cycle. `edited` marks the case where someone has changed it, so an
   * unexpected number has a visible reason.
   *
   * A number that matched nothing gets a warning marker. The banner over the work
   * item list says the same thing, but the banner is only on that tab and the
   * number itself is what would need changing — so the mark belongs next to it too.
   */
  private renderReleaseSequence() {
    const { release } = this.props
    const { noSequenceMatches } = this.props.reconciliation

    if (release.releaseSequence === null) {
      // "none" rather than "unknown": this is now reachable two ways — a version
      // with no year and cycle to derive from, and someone clearing it because the
      // release doesn't follow the cycle. The second is a decision, not a gap, and
      // calling it unknown would read as something still to be worked out.
      return (
        <span className="hotflow-sequence-unknown">
          none{' '}
          <LinkButton onClick={this.props.onEditReleaseSequence}>
            Set
          </LinkButton>
        </span>
      )
    }

    return (
      <span className="hotflow-sequence">
        {noSequenceMatches && (
          <TooltippedContent
            className="hotflow-sequence-warning"
            tooltip={
              `No work items in this repository are assigned to ` +
              `${release.releaseSequence.value}, so there's nothing to reconcile ` +
              `this release against. Either the number is wrong, or the work ` +
              `items haven't had their Release sequence number set.`
            }
            direction={TooltipDirection.SOUTH}
          >
            <Octicon symbol={octicons.alert} />
          </TooltippedContent>
        )}
        <LinkButton
          className="hotflow-sequence-value num"
          onClick={this.props.onEditReleaseSequence}
        >
          {release.releaseSequence.value}
        </LinkButton>
        {release.releaseSequence.isOverridden && (
          <span className="hotflow-sequence-edited">edited</span>
        )}
      </span>
    )
  }

  /**
   * The numbers this release is judged on.
   *
   * Two about commits and four about work items, in that order, because the
   * commit counts say whether the branch is where it should be and the work item
   * counts say whether what's on it is what was planned. The two below "Work
   * items" are the ways that can be wrong, so they read as exceptions to the
   * number above them rather than as unrelated figures.
   *
   * Unlike the commit counts, the work item rows are only meaningful when Azure
   * DevOps answered — a zero from a failed read looks exactly like a clean
   * release — so they're shown as an em dash when it didn't.
   */
  private renderPosition() {
    const { release, reconciliation } = this.props
    const isBehind = release.behindIntegration > 0
    const adoAnswered = this.props.hotFlowState.ado.status === 'ok'

    const { missingCount, untaggedCount } = reconciliation

    return (
      <dl className="hotflow-dl">
        <dt>Ahead of {this.productionName}</dt>
        <dd className="num">
          {release.aheadOfProduction}{' '}
          {release.aheadOfProduction === 1 ? 'commit' : 'commits'}
        </dd>

        <dt>Behind {this.integrationName}</dt>
        <dd className={classNames('num', { warn: isBehind, ok: !isBehind })}>
          {isBehind
            ? `${release.behindIntegration} ${
                release.behindIntegration === 1 ? 'commit' : 'commits'
              }`
            : '0'}
        </dd>

        {/* What git found in `main..release`, which is the one figure here that
            doesn't depend on Azure DevOps answering. */}
        <dt>Work items</dt>
        <dd className="num">{release.vsoNumbers.length}</dd>

        <dt>Not yet merged</dt>
        <dd
          className={classNames('num', {
            warn: missingCount > 0,
            dim: !adoAnswered,
          })}
        >
          {adoAnswered ? missingCount : '—'}
        </dd>

        <dt>Merges unassigned</dt>
        <dd
          className={classNames('num', {
            warn: untaggedCount > 0,
            dim: !adoAnswered,
          })}
        >
          {adoAnswered ? this.renderUnassigned(untaggedCount) : '—'}
        </dd>

        {/* Release-only commits used to sit here, and read as a second name for
            "Not yet merged" — two figures that can coincide but mean unrelated
            things. Finishing the release is where it matters and where it is now
            said: the merge-back step counts them and offers to fix it. */}
        <dt>Contributors</dt>
        <dd className="num">{release.contributorCount}</dd>
      </dl>
    )
  }

  /**
   * The count, as the thing that fixes it.
   *
   * The number *is* the control rather than sitting beside one: what would change
   * is exactly what you clicked, which is the clearest possible account of a bulk
   * edit to a shared system. It also keeps the column of right-aligned figures
   * intact, which a button on one row never quite did.
   *
   * Plain text at zero, and plain text with no sequence to assign — a link that
   * does nothing is worse than no link, and a release that has opted out of the
   * cycle has nothing to assign by definition.
   */
  private renderUnassigned(untaggedCount: number) {
    const { release, hotFlowState } = this.props

    if (hotFlowState.sequenceAssignment?.isRunning === true) {
      return (
        <span className="hotflow-summary-assigning">
          <Octicon symbol={octicons.sync} className="spin" />
          {untaggedCount}
        </span>
      )
    }

    if (untaggedCount === 0 || release.releaseSequence === null) {
      return untaggedCount
    }

    return (
      <TooltippedContent
        className="hotflow-summary-assign-tip"
        tooltip="Assign missing sequence number"
        direction={TooltipDirection.SOUTH}
      >
        <LinkButton
          className="hotflow-summary-assign num"
          onClick={this.props.onAssignReleaseSequence}
        >
          {untaggedCount}
        </LinkButton>
      </TooltippedContent>
    )
  }

  /**
   * What the last assignment did, when it did anything worth saying.
   *
   * Silent on a clean run: the numbers above it have already changed, which is
   * the report. It speaks up for the two cases the numbers can't show — a work
   * item left alone because it belongs to another release, and one Azure DevOps
   * refused — because both look identical to never having pressed the button.
   */
  private renderAssignmentResult() {
    const assignment = this.props.hotFlowState.sequenceAssignment

    if (assignment === null || assignment.isRunning) {
      return null
    }

    const { conflicts, failures, errorMessage } = assignment

    if (errorMessage !== null) {
      return <div className="hotflow-summary-note warn">{errorMessage}</div>
    }

    if (conflicts.length === 0 && failures.length === 0) {
      return null
    }

    return (
      <div className="hotflow-summary-note warn">
        {conflicts.length > 0 && (
          <div>
            {conflicts.length === 1
              ? `${conflicts[0].id} is assigned to ${conflicts[0].existingSequence} and was left alone.`
              : `${conflicts.length} work items are assigned to another release and were left alone.`}
          </div>
        )}
        {failures.length > 0 && (
          <div>
            {failures.length === 1
              ? `${failures[0].id} could not be assigned. `
              : `${failures.length} work items could not be assigned — ` +
                `${failures.map(f => f.id).join(', ')}. `}

            {/* The reason, not a pointer to one. Azure DevOps refuses a whole
                batch for one reason far more often than for four different ones,
                so the first message is almost always the message — and "see the
                log" is no help at all when the reason is a token's scope. */}
            {failures[0].error}
          </div>
        )}
      </div>
    )
  }

  private renderOtherReleases() {
    const { otherOpenReleases } = this.props.hotFlowState

    if (otherOpenReleases.length === 0) {
      return null
    }

    return (
      <>
        <div className="hotflow-summary-rule" />
        <h3 className="hotflow-summary-heading">Also open</h3>
        {otherOpenReleases.map(other => (
          <div className="hotflow-other-release" key={other.branch.name}>
            <span className="mono">{other.version.raw}</span>
            <span className="dim num">
              {other.aheadOfProduction}{' '}
              {other.aheadOfProduction === 1 ? 'commit' : 'commits'}
            </span>
            <LinkButton onClick={this.onViewRelease(other)}>View</LinkButton>
          </div>
        ))}
      </>
    )
  }

  private onSelectHistory = (release: IShippedRelease) => () => {
    this.props.onSelectHistoryRelease(release)
  }

  private onViewRelease = (release: IReleaseBranchState) => () => {
    this.props.onViewRelease(release)
  }

  private renderHistory() {
    const { releaseHistory } = this.props.hotFlowState

    if (releaseHistory.length === 0) {
      return (
        <>
          <h3 className="hotflow-summary-heading">Release history</h3>
          <div className="hotflow-summary-empty">
            No version tags on {this.productionName} yet.
          </div>
        </>
      )
    }

    return (
      <>
        <h3 className="hotflow-summary-heading">Release history</h3>
        <ul className="hotflow-history">
          {releaseHistory.map(release => {
            // Null while its commits are still being read, which is a wait rather
            // than an answer — see `IShippedRelease.commits`.
            const isLoading = release.commits === null

            // The oldest release in the window has no tag beneath it to diff
            // against, so there's nothing to open.
            const hasContents = (release.commits?.length ?? 0) > 0

            return (
              <li key={release.tagName}>
                <button
                  type="button"
                  className={classNames('hotflow-history-row', {
                    selected: release.tagName === this.props.selectedHistoryTag,
                    empty: !isLoading && !hasContents,
                  })}
                  disabled={!isLoading && !hasContents}
                  onClick={this.onSelectHistory(release)}
                  aria-label={
                    isLoading
                      ? `${release.tagName} — reading what it shipped`
                      : hasContents
                      ? `Show what shipped in ${release.tagName}`
                      : `${release.tagName} — nothing to compare against`
                  }
                >
                  <Octicon className="dim" symbol={octicons.tag} />
                  <span className="mono">{release.tagName}</span>
                  <span className="dim">
                    {release.shippedAt !== null ? (
                      <RelativeTime date={release.shippedAt} />
                    ) : (
                      '—'
                    )}
                  </span>
                  {isLoading ? (
                    <span className="dim hotflow-history-count">
                      <Octicon symbol={octicons.sync} className="spin" />
                    </span>
                  ) : (
                    release.vsoNumbers !== null &&
                    release.vsoNumbers.length > 0 && (
                      <span className="dim num hotflow-history-count">
                        {release.vsoNumbers.length} VSOs
                      </span>
                    )
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      </>
    )
  }
}
