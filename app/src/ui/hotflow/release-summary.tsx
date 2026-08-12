import * as React from 'react'
import {
  IHotFlowState,
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
  readonly missingWorkItemCount: number
  readonly onEditReleaseSequence: () => void
  readonly onViewRelease: (release: IReleaseBranchState) => void
  readonly onEditBranches: () => void

  /**
   * True when Azure DevOps answered but nothing is assigned to this release's
   * sequence number. False when ADO is unavailable — that's not knowing rather
   * than knowing there's nothing.
   */
  readonly noSequenceMatches: boolean

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
    const { release, noSequenceMatches } = this.props

    if (release.releaseSequence === null) {
      return (
        <span className="hotflow-sequence-unknown">
          unknown{' '}
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

  private renderPosition() {
    const { release, missingWorkItemCount } = this.props
    const isBehind = release.behindIntegration > 0

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

        {missingWorkItemCount > 0 && (
          <>
            <dt>Not yet merged</dt>
            <dd className="num warn">
              {missingWorkItemCount} work{' '}
              {missingWorkItemCount === 1 ? 'item' : 'items'}
            </dd>
          </>
        )}

        {release.releaseOnlyCommits.length > 0 && (
          <>
            <dt>Release-only commits</dt>
            <dd
              className="num warn"
              title={`${release.releaseOnlyCommits.length} commits exist only on this branch and would be orphaned on ${this.productionName} unless merged back into ${this.integrationName}`}
            >
              {release.releaseOnlyCommits.length}
            </dd>
          </>
        )}

        <dt>Contributors</dt>
        <dd className="num">{release.contributorCount}</dd>
      </dl>
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
