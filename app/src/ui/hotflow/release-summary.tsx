import * as React from 'react'
import {
  IHotFlowState,
  IResolvedBranch,
  IReleaseBranchState,
} from '../../models/hotflow'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { LinkButton } from '../lib/link-button'
import { RelativeTime } from '../relative-time'
import classNames from 'classnames'

interface IReleaseSummaryProps {
  readonly hotFlowState: IHotFlowState
  readonly release: IReleaseBranchState
  readonly missingWorkItemCount: number
  readonly onEditCycle: () => void
  readonly onConfirmCycle: () => void
  readonly onViewRelease: (release: IReleaseBranchState) => void
  readonly onEditBranches: () => void
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

          <dt>Cycle</dt>
          <dd>{this.renderCycle()}</dd>

          {release.cycle !== null && (
            <>
              {/* The Azure DevOps field this is matched against, named as it
                  appears in a work item's Details. */}
              <dt>Release sequence</dt>
              <dd className="mono">{release.cycle.tag}</dd>
            </>
          )}

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
   * The cycle, and whether we actually know it.
   *
   * An unconfirmed cycle is a guess read off the version number, and the version
   * convention varies by repo — so it's shown as unverified with a one-click
   * confirm rather than presented as fact.
   */
  private renderCycle() {
    const { release } = this.props

    if (release.cycle === null) {
      return (
        <span className="hotflow-cycle-unknown">
          unknown <LinkButton onClick={this.props.onEditCycle}>Set</LinkButton>
        </span>
      )
    }

    if (release.cycle.confirmed) {
      return (
        <span className="hotflow-cycle">
          {release.cycle.cycle}
          <span className="hotflow-cycle-confirmed">
            <Octicon className="ok" symbol={octicons.checkCircle} /> confirmed
          </span>
        </span>
      )
    }

    return (
      <span className="hotflow-cycle">
        {release.cycle.cycle}
        <span className="hotflow-cycle-unverified">unverified</span>
        <LinkButton onClick={this.props.onConfirmCycle}>Confirm</LinkButton>
        <LinkButton onClick={this.props.onEditCycle}>Edit</LinkButton>
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
          {releaseHistory.map(release => (
            <li key={release.tagName}>
              <Octicon className="dim" symbol={octicons.tag} />
              <span className="mono">{release.tagName}</span>
              <span className="dim">
                {release.shippedAt !== null ? (
                  <RelativeTime date={release.shippedAt} />
                ) : (
                  '—'
                )}
              </span>
              {release.vsoCount > 0 && (
                <span className="dim num hotflow-history-count">
                  {release.vsoCount} VSOs
                </span>
              )}
            </li>
          ))}
        </ul>
      </>
    )
  }
}
