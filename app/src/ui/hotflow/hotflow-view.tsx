import * as React from 'react'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { IBranchesState } from '../../lib/app-state'
import {
  IHotFlowState,
  IntegrationBranchAliases,
  ProductionBranchAliases,
  IFeatureLaneEntry,
  IReconciliation,
  IReleaseBranchState,
  IShippedRelease,
  ReleaseVerdict,
} from '../../models/hotflow'
import { PopupType } from '../../models/popup'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { RelativeTime } from '../relative-time'
import {
  DiagramGeometry,
  FlowDiagram,
  PullRequestKnowledge,
  actionArrowWidth,
  stubsForHeight,
} from './flow-diagram'
import {
  DefaultFlowBandHeight,
  FlowBandChromeHeight,
  FlowBandResizer,
  getStoredFlowBandHeight,
  storeFlowBandHeight,
} from './flow-band-resizer'
import { ReleaseContents, ReleaseContentsTab } from './release-contents'
import { ReleaseSummary } from './release-summary'
import { BranchChanges } from './branch-changes'
import { IChangesPaneProps } from '../changes/changes-pane'
import { reconcileRelease } from '../../lib/hotflow/reconcile'
import {
  isFeatureBranchName,
  parseFeatureBranchName,
} from '../../lib/hotflow/branch-patterns'
import { sortFeatureLane } from '../../lib/hotflow/feature-lane'
import { deriveReleaseSequence } from '../../lib/hotflow/release-sequence'
import classNames from 'classnames'
import { TipState } from '../../models/tip'
import { Branch, BranchType } from '../../models/branch'

interface IHotFlowViewProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly hotFlowState: IHotFlowState
  readonly branchesState: IBranchesState

  /**
   * Whether an authenticated GitHub account covers this repository.
   *
   * Decides whether "no pull request" is a fact or an absence of data.
   */
  readonly hasGitHubAccount: boolean

  /**
   * Everything the Branch changes tab needs to render the working directory.
   *
   * Assembled in `app.tsx`, where application state lives — the same values the
   * repository view's Changes section is built from, so the two behave identically.
   */
  readonly changesPaneProps: IChangesPaneProps
}

/**
 * Whether the Branch changes tab is offered.
 *
 * Parked for a while after it was first built, which is why it's a switch rather
 * than a condition inlined in three places — everything downstream keys off this
 * one name, so turning it off again is a one-line change rather than an
 * excavation.
 *
 * The extraction it prompted stays regardless: `changes-pane.tsx` now holds the
 * sidebar and diff wiring that `repository.tsx` used to carry inline, which is worth
 * having whether or not HotFlow ever shows a second copy of it.
 */
const BranchChangesEnabled = true

/**
 * Whether the checked-out branch is a feature branch.
 *
 * Decides whether the Branch changes tab is offered at all: on a release branch the
 * working directory isn't what HotFlow is for.
 */
function isOnFeatureBranch(branchesState: IBranchesState): boolean {
  const { tip } = branchesState

  return (
    tip.kind === TipState.Valid &&
    isFeatureBranchName(tip.branch.nameWithoutRemote)
  )
}

interface IHotFlowViewState {
  readonly selectedTab: ReleaseContentsTab

  /** Height of the flow band, in pixels. Dragged, and remembered. */
  readonly bandHeight: number

  /**
   * The shipped release being inspected, by tag, or null for the current one.
   *
   * Held by tag rather than by object so a refresh that rebuilds the history
   * doesn't leave this pointing at a stale copy — the tag is what's stable.
   */
  readonly selectedHistoryTag: string | null
}

/**
 * The HotFlow release view.
 *
 * Takes over the whole area below the toolbar — sidebar included — because the
 * flow diagram and the work item list both want horizontal room, and because
 * this is a "stop and look at the release" view rather than something you use
 * alongside the file list.
 */
export class HotFlowView extends React.Component<
  IHotFlowViewProps,
  IHotFlowViewState
> {
  /** The shipped release whose work item detail has already been asked for. */
  private requestedDetailFor: string | null = null

  public constructor(props: IHotFlowViewProps) {
    super(props)
    this.state = {
      // With the tab on, standing on a feature branch means you're working on one,
      // so it opens on the changes rather than making you click into them.
      selectedTab:
        BranchChangesEnabled && isOnFeatureBranch(props.branchesState)
          ? 'branch-changes'
          : 'work-items',
      bandHeight: getStoredFlowBandHeight(),
      selectedHistoryTag: null,
    }
  }

  /**
   * The shipped release being inspected, resolved from the tag each render.
   *
   * Returns null when the tag no longer appears in the history — a refresh can
   * drop it off the end of the window — so the panel falls back to the current
   * release rather than showing nothing.
   */
  private get historyRelease(): IShippedRelease | null {
    const { selectedHistoryTag } = this.state

    if (selectedHistoryTag === null) {
      return null
    }

    return (
      this.props.hotFlowState.releaseHistory.find(
        r => r.tagName === selectedHistoryTag
      ) ?? null
    )
  }

  /**
   * Opens a shipped release in the contents panel.
   *
   * Its commits are already loaded, but its work item detail never has been — the
   * refresh only asks Azure DevOps about the current release — so that's requested
   * here. Un-awaited: the ids render immediately and the titles fill in when they
   * arrive.
   */
  private onSelectHistoryRelease = (release: IShippedRelease) => {
    // Clicking the open one again closes it, which is what a toggle in a list of
    // one selectable thing should do.
    if (this.state.selectedHistoryTag === release.tagName) {
      this.onCloseHistory()
      return
    }

    this.setState({
      selectedHistoryTag: release.tagName,

      // Drift doesn't exist for a shipped release, so don't land on a tab that
      // isn't there.
      selectedTab:
        this.state.selectedTab === 'drift'
          ? 'work-items'
          : this.state.selectedTab,
    })

    this.loadHistoryWorkItemDetail(release)
  }

  /**
   * Requests Azure DevOps detail for a shipped release's work items.
   *
   * Its VSOs come from its commits, which are read after the refresh — so on a fast
   * click there is nothing to ask about yet, and `componentDidUpdate` picks it up
   * when they arrive instead.
   */
  private loadHistoryWorkItemDetail(release: IShippedRelease) {
    if (release.vsoNumbers === null || release.vsoNumbers.length === 0) {
      return
    }

    this.requestedDetailFor = release.tagName

    this.props.dispatcher.loadHotFlowWorkItemDetail(
      this.props.repository,
      release.vsoNumbers
    )
  }

  public componentDidUpdate() {
    const release = this.historyRelease

    // Its commits have landed since it was opened, so its work items are only now
    // knowable. Guarded by tag so this asks once rather than on every render.
    if (
      release !== null &&
      release.vsoNumbers !== null &&
      this.requestedDetailFor !== release.tagName
    ) {
      this.loadHistoryWorkItemDetail(release)
    }
  }

  private onCloseHistory = () => {
    this.setState({ selectedHistoryTag: null })
  }

  private get integrationName(): string {
    return this.props.hotFlowState.integrationBranchName
  }

  /**
   * Whether pull request state is something we actually know for this repository.
   *
   * Desktop only fetches pull requests for a GitHub repository with an
   * authenticated account. Without one the list is permanently empty, and
   * labelling every branch "no PR" would be reporting missing data as a finding.
   */
  private get pullRequestKnowledge(): PullRequestKnowledge {
    const { isLoadingPullRequests, pullRequestsLastRefreshed } =
      this.props.branchesState

    // No account means Desktop will never fetch, so nothing is knowable.
    if (!this.props.hasGitHubAccount) {
      return 'unavailable'
    }

    // Never fetched yet — a refresh is on its way, so don't report an empty
    // list as a finding in the meantime.
    if (isLoadingPullRequests || pullRequestsLastRefreshed === undefined) {
      return 'loading'
    }

    return 'known'
  }

  /**
   * How many feature branches the diagram can show at the current band height.
   *
   * The schematic is drawn at a fixed scale, so dragging the resizer buys more
   * visible branches rather than a magnified picture. The subtraction accounts
   * for the band's own padding, the action row beneath the diagram, and the
   * horizontal scrollbar.
   */
  private get maxStubs(): number {
    return stubsForHeight(this.state.bandHeight - FlowBandChromeHeight)
  }

  /**
   * The feature branches feeding the integration branch, those with an open pull
   * request first and ordered by VSO number within that.
   *
   * Sourced from git rather than from the pull request list. Desktop only knows
   * about pull requests once it has fetched them from the API, so keying the lane
   * on them makes real branches disappear — the branch is the fact, the pull
   * request is an annotation on it. See `compareFeatureLaneEntries` for the order.
   */
  private get featureLane(): ReadonlyArray<IFeatureLaneEntry> {
    const integrationName = this.props.hotFlowState.integrationBranchName

    // Branch name -> pull request number, for whatever pull requests we have.
    const pullRequests = new Map(
      this.props.branchesState.openPullRequests
        .filter(pr => pr.base.ref === integrationName)
        .map(pr => [pr.head.ref, pr.pullRequestNumber] as const)
    )

    return sortFeatureLane(
      this.props.hotFlowState.openFeatureBranches.map(feature => {
        const name = feature.branch.nameWithoutRemote

        return {
          branchName: name,
          pullRequestNumber: pullRequests.get(name) ?? null,
          isRemoteOnly: feature.branch.type === BranchType.Remote,
          vso: parseFeatureBranchName(name)?.vso ?? null,
        }
      })
    )
  }

  /**
   * The working directory pane, or null when there's no feature branch for it.
   *
   * Returning null is what removes the tab, so the two can't disagree about whether
   * it's on offer.
   */
  private renderBranchChanges(): JSX.Element | null {
    if (!BranchChangesEnabled || !isOnFeatureBranch(this.props.branchesState)) {
      return null
    }

    return (
      <BranchChanges
        changesPaneProps={this.props.changesPaneProps}
        branchName={this.currentBranchName}
      />
    )
  }

  /** The checked out branch, or null when the tip is detached or unborn. */
  private get currentBranchName(): string | null {
    const tip = this.props.branchesState.tip

    return tip.kind === TipState.Valid ? tip.branch.nameWithoutRemote : null
  }

  /**
   * Checks out a feature branch from the lane.
   *
   * Goes through the dispatcher rather than straight to git so it picks up
   * Desktop's whole checkout flow — uncommitted changes get the stash prompt, and
   * a remote-only branch gets a local one created to track it.
   */
  private onCheckoutFeatureBranch = (entry: IFeatureLaneEntry) => {
    const feature = this.props.hotFlowState.openFeatureBranches.find(
      f => f.branch.nameWithoutRemote === entry.branchName
    )

    if (feature === undefined) {
      return
    }

    this.props.dispatcher.checkoutBranch(this.props.repository, feature.branch)
  }

  /**
   * Checks out one of the named branches in the diagram — develop, the release
   * branch, or main.
   *
   * Same dispatcher path as the feature stubs, so it picks up the stash prompt and
   * creates a local branch to track a remote-only one.
   */
  private onCheckoutRef = (branch: Branch) => {
    this.props.dispatcher.checkoutBranch(this.props.repository, branch)
  }

  /**
   * Opens the merge confirmation for a branch's pull request.
   *
   * The lane entry carries only the number, so the pull request itself is looked
   * up here for the head sha the merge is pinned to. If it has gone from the list
   * — merged or closed under us — there is nothing to confirm, and a refresh will
   * drop the button on its own.
   */
  private onMergePullRequest = (entry: IFeatureLaneEntry) => {
    const pullRequest = this.props.branchesState.openPullRequests.find(
      pr => pr.pullRequestNumber === entry.pullRequestNumber
    )

    if (pullRequest === undefined) {
      return
    }

    const htmlURL = pullRequest.base.gitHubRepository.htmlURL

    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowMergePullRequest,
      repository: this.props.repository,
      pullRequestNumber: pullRequest.pullRequestNumber,
      branchName: pullRequest.head.ref,
      baseBranchName: pullRequest.base.ref,
      title: pullRequest.title,
      headSha: pullRequest.head.sha,
      pullRequestUrl:
        htmlURL === null
          ? null
          : `${htmlURL}/pull/${pullRequest.pullRequestNumber}`,
    })
  }

  public render() {
    const { missingRequiredBranches } = this.props.hotFlowState

    return (
      <div className="hotflow" id="hotflow">
        {this.renderHeader()}
        {missingRequiredBranches.length > 0
          ? this.renderMissingBranches()
          : this.renderFlow()}
      </div>
    )
  }

  private renderHeader() {
    const { hotFlowState, repository } = this.props
    const { isLoading, lastRefreshed } = hotFlowState

    return (
      <div className="hotflow-header">
        <div className="hotflow-header-left">
          <h1 className="hotflow-title">HotFlow</h1>
          <span className="hotflow-repo">
            {repository.alias ?? repository.name}
          </span>
          {this.renderVerdict()}
        </div>
        <div className="hotflow-header-right">
          {isLoading ? (
            <span className="dim">Refreshing…</span>
          ) : lastRefreshed !== null ? (
            <span className="dim">
              Refreshed <RelativeTime date={new Date(lastRefreshed)} />
            </span>
          ) : null}
          <Button
            className="hotflow-icon-button"
            onClick={this.onRefresh}
            disabled={isLoading}
            ariaLabel="Refresh release data"
            tooltip="Refresh release data"
          >
            <Octicon symbol={octicons.sync} />
          </Button>
          <Button
            className="hotflow-icon-button"
            onClick={this.onClose}
            ariaLabel="Close HotFlow"
            tooltip="Close HotFlow"
          >
            <Octicon symbol={octicons.x} />
          </Button>
        </div>
      </div>
    )
  }

  /**
   * The verdict chip. Encoded as icon plus text plus colour, never colour alone.
   *
   * Note this is the *effective* verdict: git can say a release is ready, but if
   * Azure DevOps knows about work items assigned to the release that aren't in it
   * branch, it isn't.
   */
  private renderVerdict() {
    const { hotFlowState } = this.props
    const release = hotFlowState.currentRelease

    if (hotFlowState.errorMessage !== null) {
      return (
        <span className="hotflow-verdict error">
          <Octicon symbol={octicons.alert} /> Couldn't read this repository
        </span>
      )
    }

    if (release === null) {
      return <span className="hotflow-verdict none">No release branch</span>
    }

    const verdict = this.getEffectiveVerdict(release)

    switch (verdict) {
      case 'ready':
        return (
          <span className="hotflow-verdict ok">
            <Octicon symbol={octicons.checkCircle} /> Ready
          </span>
        )
      case 'needs-update':
        return (
          <span className="hotflow-verdict warn">
            <Octicon symbol={octicons.alert} /> Needs update
          </span>
        )
      case 'shipped':
        return (
          <span className="hotflow-verdict shipped">
            <Octicon symbol={octicons.checkCircle} /> Shipped
          </span>
        )
      default:
        return <span className="hotflow-verdict none">Unknown</span>
    }
  }

  /**
   * Combines the git verdict with what Azure DevOps knows. A release that git
   * thinks is current is still `needs-update` if assigned work items haven't
   * been merged.
   */
  private getEffectiveVerdict(release: IReleaseBranchState): ReleaseVerdict {
    if (release.verdict === 'shipped' || release.verdict === 'unknown') {
      return release.verdict
    }

    return this.getReconciliation(release).missingCount > 0
      ? 'needs-update'
      : release.verdict
  }

  private getReconciliation(release: IReleaseBranchState): IReconciliation {
    return reconcileRelease(this.props.hotFlowState, release)
  }

  /**
   * Shown when the repository doesn't have the branches HotFlow needs. Explains
   * what's missing rather than rendering a dashboard full of zeroes.
   */
  private renderMissingBranches() {
    const { missingRequiredBranches } = this.props.hotFlowState

    const missingIntegration = missingRequiredBranches.includes('integration')
    const missingProduction = missingRequiredBranches.includes('production')

    return (
      <div className="hotflow-blocked">
        <div className="hotflow-blocked-inner">
          <Octicon className="dim" symbol={octicons.gitBranch} />
          <h2>
            HotFlow needs {missingRequiredBranches.length === 1 ? 'a' : 'two'}{' '}
            {missingRequiredBranches.length === 1 ? 'branch' : 'branches'}
          </h2>

          {missingIntegration && (
            <p>
              No integration branch found — looked for{' '}
              {IntegrationBranchAliases.map((alias, i) => (
                <React.Fragment key={alias}>
                  {i > 0 && ', '}
                  <span className="mono">{alias}</span>
                </React.Fragment>
              ))}
              .
            </p>
          )}

          {missingProduction && (
            <p>
              No production branch found — looked for{' '}
              {ProductionBranchAliases.map((alias, i) => (
                <React.Fragment key={alias}>
                  {i > 0 && ', '}
                  <span className="mono">{alias}</span>
                </React.Fragment>
              ))}
              , and the repository's default branch.
            </p>
          )}

          <p className="dim">
            HotFlow measures everything against those two branches, so without
            them there's nothing to show. If this repository names them
            differently, point HotFlow at the right ones.
          </p>

          <Button type="submit" onClick={this.onEditBranches}>
            Choose branches
          </Button>
        </div>
      </div>
    )
  }

  private renderFlow() {
    const { hotFlowState } = this.props
    const release = hotFlowState.currentRelease

    const missingWorkItemCount =
      release === null ? 0 : this.getReconciliation(release).missingCount

    const lastShippedVersion =
      hotFlowState.releaseHistory.length > 0
        ? hotFlowState.releaseHistory[0].tagName
        : null

    // With no release branch the diagram's middle is a placeholder and the drift,
    // merge-and-tag and finish stages measure nothing — the band would be a
    // schematic of a flow that isn't running. The page below says so instead, and
    // carries its own Start release branch button, so nothing is lost by dropping
    // the band and its resizer.
    if (release === null) {
      return this.renderNoRelease()
    }

    return (
      <>
        {/* Dimmed while re-reading, because the boxes and their counts still
            describe the release being switched away from. Dimmed rather than
            emptied: the shape of the flow doesn't change between releases, and
            blanking it would make the whole view flash on every branch switch. */}
        <div
          className={classNames('hotflow-flow-band', {
            loading: hotFlowState.isLoading,
          })}
          style={{ height: this.state.bandHeight }}
        >
          {/* Diagram and actions share one scroll container so the buttons stay
              aligned with the nodes above them when the band is scrolled. */}
          <div className="hotflow-flow-scroll">
            <FlowDiagram
              hotFlowState={hotFlowState}
              missingWorkItemCount={missingWorkItemCount}
              lastShippedVersion={lastShippedVersion}
              featureLane={this.featureLane}
              maxStubs={this.maxStubs}
              pullRequestKnowledge={this.pullRequestKnowledge}
              approvals={hotFlowState.pullRequestApprovals}
              onMergePullRequest={this.onMergePullRequest}
              currentBranchName={this.currentBranchName}
              onCheckoutBranch={this.onCheckoutFeatureBranch}
              onCheckoutRef={this.onCheckoutRef}
            />
            {this.renderActions()}
          </div>
        </div>

        <FlowBandResizer
          height={this.state.bandHeight}
          onHeightChanged={this.onBandHeightChanged}
          onReset={this.onBandHeightReset}
        />
        {this.renderReleaseBody(release, missingWorkItemCount)}
      </>
    )
  }

  /**
   * The stage actions, laid out on a grid whose columns match the diagram's
   * nodes above them, with arrows carrying the same left-to-right progression.
   *
   * Each button sits directly beneath the thing it acts on, so the row reads as
   * part of the flow rather than as a detached toolbar. Exactly one action is
   * emphasised — whatever the sensible next step is — so the view always has a
   * single obvious move.
   */
  private renderActions() {
    const { hotFlowState, branchesState } = this.props
    const release = hotFlowState.currentRelease

    const tip = branchesState.tip
    const onFeatureBranch =
      tip.kind === TipState.Valid && isFeatureBranchName(tip.branch.name)

    const isBehind = (release?.behindIntegration ?? 0) > 0
    const canFinish =
      release !== null &&
      !isBehind &&
      this.getReconciliation(release).missingCount === 0

    return (
      <div className="hotflow-actions">
        {/*
          Start feature and Open pull request are one connected pair — both act
          on getting work into the integration branch — so they sit flush
          together and span from the feature stubs across to it.
        */}
        <div className="hotflow-action-pair">
          <Button onClick={this.onStartFeature}>Start feature</Button>
          <Button onClick={this.onOpenPullRequest} disabled={!onFeatureBranch}>
            Open pull request
          </Button>
        </div>

        {this.renderActionArrow(actionArrowWidth)}

        {/* under the release branch */}
        <div className="hotflow-action-cell">
          {release === null ? (
            <Button type="submit" onClick={this.onStartRelease}>
              Start release
            </Button>
          ) : (
            <Button
              type={isBehind ? 'submit' : 'button'}
              onClick={this.onUpdateRelease}
              disabled={!isBehind}
            >
              Update from {this.integrationName}
            </Button>
          )}
        </div>

        {release === null ? (
          <div className="hotflow-action-spacer" />
        ) : (
          this.renderActionArrow(DiagramGeometry.tagEdge)
        )}

        {/* under the production branch */}
        <div className="hotflow-action-cell">
          {release !== null && (
            <Button
              type={canFinish ? 'submit' : 'button'}
              onClick={this.onFinishRelease}
            >
              Finish release
            </Button>
          )}
        </div>
      </div>
    )
  }

  /**
   * The connector between action groups.
   *
   * Now that the diagram renders unscaled, these are plain SVG lines using the
   * same `hotflow-edge` stroke and the same arrow marker geometry — so they're
   * the same line as the connectors between the boxes above, not an imitation.
   *
   * @param width The column's width in pixels, which equals SVG units here.
   */
  private renderActionArrow(width: number) {
    return (
      <div className="hotflow-action-arrow">
        <svg
          width={width}
          height={12}
          viewBox={`0 0 ${width} 12`}
          focusable="false"
          aria-hidden="true"
        >
          <defs>
            <marker
              id="hotflow-action-arrowhead"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path className="hotflow-arrowhead" d="M0,1 L8,5 L0,9" />
            </marker>
          </defs>
          <path
            className="hotflow-edge"
            d={`M0,6 L${width - 6},6`}
            fill="none"
            markerEnd="url(#hotflow-action-arrowhead)"
          />
        </svg>
      </div>
    )
  }

  private renderReleaseBody(
    release: IReleaseBranchState,
    missingWorkItemCount: number
  ) {
    return (
      <div className="hotflow-body">
        <ReleaseContents
          release={release}
          reconciliation={this.getReconciliation(release)}
          ado={this.props.hotFlowState.ado}
          selectedTab={this.state.selectedTab}
          onTabChanged={this.onTabChanged}
          onConnectAdo={this.onConnectAdo}
          integrationBranchName={this.integrationName}
          historyRelease={this.historyRelease}
          onCloseHistory={this.onCloseHistory}
          branchChanges={this.renderBranchChanges()}
          isLoading={this.props.hotFlowState.isLoading}
          changedFileCount={
            this.props.changesPaneProps.state.changesState.workingDirectory
              .files.length
          }
        />
        <ReleaseSummary
          hotFlowState={this.props.hotFlowState}
          release={release}
          missingWorkItemCount={missingWorkItemCount}
          onEditReleaseSequence={this.onEditReleaseSequence}
          onViewRelease={this.onViewRelease}
          onEditBranches={this.onEditBranches}
          noSequenceMatches={this.getReconciliation(release).noSequenceMatches}
          selectedHistoryTag={this.state.selectedHistoryTag}
          onSelectHistoryRelease={this.onSelectHistoryRelease}
        />
      </div>
    )
  }

  /**
   * The empty state, which argues for cutting a release rather than just
   * reporting that there isn't one. The four figures are the decision.
   */
  private renderNoRelease() {
    const { hotFlowState } = this.props
    const lastShipped =
      hotFlowState.releaseHistory.length > 0
        ? hotFlowState.releaseHistory[0].tagName
        : null

    return (
      <div className="hotflow-blocked">
        <div className="hotflow-blocked-inner">
          <Octicon className="dim" symbol={octicons.gitBranch} />
          <h2>No release branch for this repository</h2>
          <p>
            Nothing matching <span className="mono">release/*</span> is waiting
            to ship.
          </p>

          <div className="hotflow-empty-stats">
            <div>
              <span className="hotflow-stat-value num">
                {hotFlowState.unreleasedCommitCount}
              </span>
              <span className="hotflow-stat-label">commits unreleased</span>
            </div>
            <div>
              <span className="hotflow-stat-value num">
                {hotFlowState.unreleasedVsoCount}
              </span>
              <span className="hotflow-stat-label">work items</span>
            </div>
            <div>
              <span className="hotflow-stat-value mono">
                {lastShipped ?? '—'}
              </span>
              <span className="hotflow-stat-label">last shipped</span>
            </div>
            <div>
              <span className="hotflow-stat-value mono accent">
                {hotFlowState.nextVersion ?? '—'}
              </span>
              <span className="hotflow-stat-label">next version</span>
            </div>
          </div>

          <Button type="submit" onClick={this.onStartRelease}>
            Start release branch
          </Button>

          {hotFlowState.nextVersion !== null && (
            <p className="hotflow-blocked-footnote">
              Creates{' '}
              <span className="mono">release/{hotFlowState.nextVersion}</span>{' '}
              from <span className="mono">origin/{this.integrationName}</span>
            </p>
          )}
        </div>
      </div>
    )
  }

  private onTabChanged = (selectedTab: ReleaseContentsTab) => {
    this.setState({ selectedTab })
  }

  private onBandHeightChanged = (bandHeight: number) => {
    this.setState({ bandHeight })
  }

  private onBandHeightReset = () => {
    this.setState({ bandHeight: DefaultFlowBandHeight })
    storeFlowBandHeight(DefaultFlowBandHeight)
  }

  private onRefresh = () => {
    this.props.dispatcher.refreshHotFlow(this.props.repository)
  }

  private onClose = () => {
    this.props.dispatcher.hideHotFlow()
  }

  private onStartFeature = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowStartFeature,
      repository: this.props.repository,
    })
  }

  private onStartRelease = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowStartRelease,
      repository: this.props.repository,
    })
  }

  private onUpdateRelease = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowUpdateRelease,
      repository: this.props.repository,
    })
  }

  private onFinishRelease = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowFinishRelease,
      repository: this.props.repository,
    })
  }

  private onEditBranches = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowEditBranches,
      repository: this.props.repository,
    })
  }

  private onConnectAdo = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowConnectAdo,
      repository: this.props.repository,
    })
  }

  private onOpenPullRequest = () => {
    const integrationBranch = this.props.hotFlowState.integrationBranch

    if (integrationBranch === null) {
      return
    }

    // Base is forced to development. Desktop would otherwise default to the
    // repository's default branch, which is main — the wrong target every time.
    this.props.dispatcher.createPullRequest(
      this.props.repository,
      integrationBranch
    )
  }

  private onEditReleaseSequence = () => {
    const release = this.props.hotFlowState.currentRelease

    if (release === null) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowEditReleaseSequence,
      repository: this.props.repository,
      branchName: release.branch.nameWithoutRemote,
      currentSequence: release.releaseSequence?.value ?? null,

      // Recomputed rather than carried, so the dialog's "use that instead" always
      // offers what the version says right now.
      derivedSequence: deriveReleaseSequence(release.version),
    })
  }

  /**
   * Switching focus to another open release. Checking it out is the honest way
   * to "view" it, since every range in the view is computed against branches.
   */
  private onViewRelease = (release: IReleaseBranchState) => {
    this.props.dispatcher.checkoutBranch(this.props.repository, release.branch)
  }
}
