import * as React from 'react'
import {
  ApprovalsForReady,
  IFeatureLaneEntry,
  IHotFlowState,
  IPullRequestApproval,
  IReleaseBranchState,
} from '../../models/hotflow'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Tooltip } from '../lib/tooltip'
import { createObservableRef } from '../lib/observable-ref'

/**
 * The diagram's geometry, in viewBox units.
 *
 * Every coordinate is derived from these rather than written out, so the
 * schematic can be re-proportioned in one place. The column widths are mirrored
 * in `_hotflow.scss` so the action buttons line up with the nodes above them —
 * change these and change those.
 */
export const DiagramGeometry = {
  /** Left inset the leftmost box starts at. */
  inset: 8,

  /** Feature branch stubs. Wide enough for a real branch name. */
  featureWidth: 352,

  /** Gap the pull request connector spans. */
  prEdge: 66,

  integrationWidth: 176,

  /** Gap the drift connector spans. */
  driftEdge: 114,

  releaseWidth: 212,

  /** Gap the merge-and-tag connector spans. */
  tagEdge: 122,

  productionWidth: 158,

  stubHeight: 26,
  stubGap: 7,

  /** Vertical padding above the topmost stub and below the caption. */
  padding: 16,

  /** Space the caption line under the stubs occupies. */
  captionHeight: 34,

  /**
   * The height the main row needs even with a single stub.
   *
   * The develop → release → main boxes and their connectors don't shrink, so the
   * diagram has a floor regardless of how few branches are drawn. This is what
   * `minDiagramHeight` is built from.
   */
  minContentHeight: 84,

  /** Width of each button in the action row, so the arrows can be sized. */
  actionButtonWidth: 168,

  /** Gap between them — mirrors `--spacing-half`. */
  actionButtonGap: 5,
}

const G = DiagramGeometry

const featureX = G.inset
const featureRight = featureX + G.featureWidth

const integrationX = featureRight + G.prEdge
const integrationRight = integrationX + G.integrationWidth

const releaseX = integrationRight + G.driftEdge
const releaseRight = releaseX + G.releaseWidth

const productionX = releaseRight + G.tagEdge
const productionRight = productionX + G.productionWidth

export const diagramWidth = productionRight + G.inset

/** Connectors stop short of the box they point at, leaving room for the head. */
const edgeGap = 6

/**
 * The shortest the diagram ever renders, with one stub drawn.
 *
 * The band can't usefully be dragged below this plus its own chrome: the diagram
 * has already bottomed out, so the only thing left to give is the action row,
 * which then gets clipped by the band's `overflow: hidden`.
 */
export const minDiagramHeight =
  G.minContentHeight + G.captionHeight + G.padding * 2

/**
 * The action row's geometry, derived from the diagram's own columns.
 *
 * The two buttons sit in the space above which the feature stubs, the pull
 * request edge and the integration node live; the connector takes the rest of the
 * way to the release column. Both are fixed widths, so the connector can be drawn
 * with the diagram's real arrow marker at 1:1 scale rather than a stretched
 * approximation of it.
 */
export const actionPairWidth = G.actionButtonWidth * 2 + G.actionButtonGap

export const actionArrowWidth =
  G.featureWidth + G.prEdge + G.integrationWidth + G.driftEdge - actionPairWidth

/**
 * How many stubs fit in a diagram of the given height.
 *
 * Resizing the band reveals more branches rather than magnifying the schematic,
 * so the row count follows the available height.
 */
export function stubsForHeight(height: number): number {
  const forStubs = height - G.captionHeight - G.padding * 2

  return clampStubCount(
    Math.floor((forStubs + G.stubGap) / (G.stubHeight + G.stubGap))
  )
}

function clampStubCount(count: number): number {
  return Math.max(1, Math.min(count, 24))
}

/**
 * Whether pull request state is knowable for this repository.
 *
 * An empty pull request list is ambiguous — it means "none open" when Desktop has
 * fetched them, and "we have no idea" when it hasn't. Without an authenticated
 * account Desktop never fetches at all, and labelling every branch "no PR" in
 * that case is an assertion we haven't earned.
 */
export type PullRequestKnowledge = 'known' | 'loading' | 'unavailable'

interface IFlowDiagramProps {
  readonly hotFlowState: IHotFlowState

  /** Number of work items assigned to the release but missing from it. */
  readonly missingWorkItemCount: number

  /** The most recently shipped version, shown under the production branch. */
  readonly lastShippedVersion: string | null

  /**
   * Feature branches with unmerged work, those with an open pull request first.
   *
   * Branches with a pull request get a solid connector; the rest are drawn faint
   * with a dashed connector, since they haven't entered the flow yet.
   */
  readonly featureLane: ReadonlyArray<IFeatureLaneEntry>

  /**
   * How many stubs to draw, from the height the band has been given.
   *
   * The schematic renders at a fixed scale, so extra height buys more visible
   * branches rather than a larger picture.
   */
  readonly maxStubs: number

  /** Whether "no pull request" is something we actually know. */
  readonly pullRequestKnowledge: PullRequestKnowledge

  /**
   * Approval counts by pull request number. A missing entry means unknown, which
   * is deliberately not the same as unapproved.
   */
  readonly approvals: ReadonlyMap<number, IPullRequestApproval>

  /** Invoked when a branch's merge button is pressed. */
  readonly onMergePullRequest: (entry: IFeatureLaneEntry) => void

  /**
   * The checked out branch, so the lane doesn't offer to check out the branch
   * you're already on. Null when the tip is detached or unborn.
   */
  readonly currentBranchName: string | null

  /** Invoked when a feature stub is clicked. */
  readonly onCheckoutBranch: (entry: IFeatureLaneEntry) => void
}

interface IBranchNameLinkProps {
  readonly entry: IFeatureLaneEntry

  /** Dimmed to match the hollow stub of a branch with no pull request. */
  readonly idle: boolean

  /** Says what clicking does, since the name alone only says where. */
  readonly tooltip: string

  readonly style: React.CSSProperties

  readonly onCheckout: (entry: IFeatureLaneEntry) => void
}

/**
 * A feature branch's name, as a link that checks it out.
 *
 * Its own component to hold the ref its tooltip needs. The visible text is the
 * branch name, which says where you'd go but not that clicking goes there — the
 * tooltip covers that, and covers the remote-only case too.
 */
class BranchNameLink extends React.Component<IBranchNameLinkProps> {
  private buttonRef = createObservableRef<HTMLButtonElement>()

  public render() {
    const { entry, idle, tooltip, style } = this.props

    return (
      <button
        ref={this.buttonRef}
        type="button"
        className={`hotflow-branch-name link${idle ? ' dim' : ''}`}
        style={style}
        onClick={this.onClick}
      >
        <Tooltip target={this.buttonRef}>{tooltip}</Tooltip>
        {entry.branchName}
      </button>
    )
  }

  private onClick = () => {
    this.props.onCheckout(this.props.entry)
  }
}

interface IMergeButtonProps {
  readonly entry: IFeatureLaneEntry

  /** Undefined when reviews haven't been read — not the same as no approvals. */
  readonly approval: IPullRequestApproval | undefined

  /** What merging this would do, used for both the tooltip and the label. */
  readonly label: string

  readonly left: number
  readonly top: number

  readonly onMerge: (entry: IFeatureLaneEntry) => void
}

/**
 * The merge button on a feature stub.
 *
 * Its own component so it can hold the ref its tooltip needs — the approval count
 * is the whole reason the button is one colour rather than the other, and a 20px
 * icon has nowhere to say so.
 */
class MergeButton extends React.Component<IMergeButtonProps> {
  private buttonRef = createObservableRef<HTMLButtonElement>()

  public render() {
    const { approval, label, left, top } = this.props

    const ready =
      approval !== undefined && approval.approvals >= ApprovalsForReady

    return (
      <button
        ref={this.buttonRef}
        type="button"
        className={`hotflow-merge-button ${ready ? 'ready' : 'short'}`}
        style={{ left, top }}
        onClick={this.onClick}
        aria-label={label}
      >
        <Tooltip target={this.buttonRef}>{label}</Tooltip>
        <Octicon symbol={octicons.gitMerge} />
      </button>
    )
  }

  private onClick = () => {
    this.props.onMerge(this.props.entry)
  }
}

/**
 * The four-stage flow schematic:
 *
 *   feature/* --PR--> develop --> release/x --merge+tag--> main
 *
 * Hand-drawn SVG rather than the commit graph's layout engine, because this is a
 * fixed schematic with named stages, not a variable-topology graph. Drift is
 * drawn *on* the integration-to-release connector rather than filed away as a
 * statistic, so the thing that's wrong appears where it's wrong.
 *
 * All colour comes from CSS custom properties, so light and dark themes are
 * handled by the stylesheet rather than by branching here.
 */
export class FlowDiagram extends React.Component<IFlowDiagramProps> {
  /**
   * The resolved branch names. Never assumed — repositories disagree about
   * whether integration is `develop`, `development` or `dev`.
   */
  private get integrationName(): string {
    return this.props.hotFlowState.integrationBranchName
  }

  private get productionName(): string {
    return this.props.hotFlowState.productionBranchName
  }

  /** The stubs actually drawn, limited by the room the band has. */
  private get shownEntries(): ReadonlyArray<IFeatureLaneEntry> {
    return this.props.featureLane.slice(0, Math.max(1, this.props.maxStubs))
  }

  /**
   * The vertical centre of the flow, and the diagram's height in pixels.
   *
   * Both grow with the number of stubs so the fan always has room and the main
   * row stays centred against it. One unit is one pixel — the diagram is never
   * scaled, so resizing shows more rows rather than a bigger picture.
   */
  private get layout() {
    const count = Math.max(this.shownEntries.length, 1)
    const stackHeight = count * G.stubHeight + (count - 1) * G.stubGap

    const contentHeight = Math.max(stackHeight, G.minContentHeight)

    return {
      height: contentHeight + G.captionHeight + G.padding * 2,
      midY: G.padding + contentHeight / 2,
      stackHeight,
    }
  }

  public render() {
    const { hotFlowState } = this.props
    const release = hotFlowState.currentRelease
    const { height } = this.layout

    return (
      <div className="hotflow-diagram">
        {/* Explicit width and height, so one unit is one pixel and nothing is
            scaled. Resizing the band changes how many rows fit, not their size. */}
        <svg
          className="hotflow-diagram-svg"
          width={diagramWidth}
          height={height}
          viewBox={`0 0 ${diagramWidth} ${height}`}
          role="img"
          aria-label={this.getAccessibleDescription()}
        >
          <defs>
            <marker
              id="hotflow-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path className="hotflow-arrowhead" d="M0,1 L8,5 L0,9" />
            </marker>
            <marker
              id="hotflow-arrow-warn"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path className="hotflow-arrowhead warn" d="M0,1 L8,5 L0,9" />
            </marker>
            <marker
              id="hotflow-arrow-ok"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path className="hotflow-arrowhead ok" d="M0,1 L8,5 L0,9" />
            </marker>
          </defs>

          {this.renderFeatureStubs()}
          {this.renderFeatureConnectors()}
          {this.renderIntegrationNode()}
          {this.renderDriftEdge()}
          {release === null
            ? this.renderNoReleaseNode()
            : this.renderReleaseNode(release)}
          {this.renderProductionEdge()}
          {this.renderProductionNode()}
        </svg>
        {this.renderBranchNames()}
        {this.renderMergeButtons()}
      </div>
    )
  }

  /**
   * The branch name on each stub, as a link that checks the branch out.
   *
   * HTML rather than SVG `<text>`, so the name can *be* the control: a link is
   * styled, underlined on hover and clickable in one element, whereas an overlay
   * button can't reach into the SVG to style the text beneath it. It also means
   * the name ellipsises only when it genuinely doesn't fit, rather than being cut
   * at a guessed character count.
   *
   * The branch you're already on is plain text — there's nothing to go to.
   */
  private renderBranchNames() {
    const centres = this.stubCentres

    // Left inset plus the right-hand slot the pull request badge and merge
    // button share. Matches the SVG's own coordinates for both.
    const maxWidth = G.featureWidth - 10 - 86

    return (
      <div className="hotflow-branch-names">
        {this.shownEntries.map((entry, i) => {
          const idle =
            entry.pullRequestNumber === null &&
            this.props.pullRequestKnowledge === 'known'

          const style = {
            left: featureX + 10,
            top: centres[i] - G.stubHeight / 2,
            height: G.stubHeight,
            maxWidth,
          }

          if (entry.branchName === this.props.currentBranchName) {
            return (
              <span
                key={entry.branchName}
                className="hotflow-branch-name current"
                style={style}
              >
                {entry.branchName}
              </span>
            )
          }

          return (
            <BranchNameLink
              key={entry.branchName}
              entry={entry}
              idle={idle}
              tooltip={
                entry.isRemoteOnly
                  ? `Check out ${entry.branchName} — creates a local branch`
                  : `Check out ${entry.branchName}`
              }
              style={style}
              onCheckout={this.props.onCheckoutBranch}
            />
          )
        })}
      </div>
    )
  }

  /**
   * Merge buttons for branches with an open pull request.
   *
   * Real HTML buttons positioned over the SVG rather than clickable SVG groups:
   * a `<g>` with a click handler is a non-interactive element to the
   * accessibility linter, and buttons get focus, roles and keyboard handling for
   * free. This only works cleanly because the diagram is unscaled — one viewBox
   * unit is one pixel, so the coordinates map straight across.
   */
  private renderMergeButtons() {
    const entries = this.shownEntries
    const centres = this.stubCentres

    return (
      <div className="hotflow-merge-buttons">
        {entries.map((entry, i) => {
          if (entry.pullRequestNumber === null) {
            return null
          }

          const approval = this.props.approvals.get(entry.pullRequestNumber)

          return (
            <MergeButton
              key={entry.branchName}
              entry={entry}
              approval={approval}
              label={this.getMergeButtonLabel(entry, approval)}
              left={featureX + G.featureWidth - 26}
              top={centres[i] - 9}
              onMerge={this.props.onMergePullRequest}
            />
          )
        })}
      </div>
    )
  }

  /** Says what merging this would do, and how well reviewed it is. */
  private getMergeButtonLabel(
    entry: IFeatureLaneEntry,
    approval: IPullRequestApproval | undefined
  ): string {
    const base = `Merge #${entry.pullRequestNumber} into ${this.integrationName}`

    if (approval === undefined) {
      return `${base} — review state unknown`
    }

    if (approval.changesRequested > 0) {
      return `${base} — changes requested`
    }

    return `${base} — ${approval.approvals} of ${ApprovalsForReady} approvals`
  }

  /**
   * A text equivalent of the diagram. The schematic carries real information, so
   * it needs to be readable without seeing it.
   */
  private getAccessibleDescription(): string {
    const { hotFlowState, missingWorkItemCount, lastShippedVersion } =
      this.props
    const release = hotFlowState.currentRelease
    const lane = this.props.featureLane
    const withPr = lane.filter(e => e.pullRequestNumber !== null).length

    const parts: Array<string> = [
      `${lane.length} open feature ${
        lane.length === 1 ? 'branch' : 'branches'
      } feeding ${this.integrationName}` +
        (this.props.pullRequestKnowledge === 'known'
          ? `, ${withPr} with an open pull request.`
          : '. Pull request status is unavailable.'),
      `${hotFlowState.unreleasedCommitCount} commits in ${this.integrationName} are not yet in production.`,
    ]

    if (release === null) {
      parts.push('There is no release branch.')
    } else {
      parts.push(
        `Release ${release.version.raw} is ${release.aheadOfProduction} commits ahead of ${this.productionName}` +
          ` and ${release.behindIntegration} commits behind ${this.integrationName},` +
          ` holding ${release.vsoNumbers.length} work items.`
      )

      if (missingWorkItemCount > 0) {
        parts.push(
          `${missingWorkItemCount} work items assigned to this release are not in it yet.`
        )
      }
    }

    if (lastShippedVersion !== null) {
      parts.push(`The last shipped version was ${lastShippedVersion}.`)
    }

    return parts.join(' ')
  }

  /** The y centre of each drawn stub. */
  private get stubCentres(): ReadonlyArray<number> {
    const { stackHeight, midY } = this.layout

    if (this.shownEntries.length === 0) {
      return []
    }

    // Centre the stack on the flow's midline.
    const top = midY - stackHeight / 2

    return this.shownEntries.map(
      (_, i) => top + i * (G.stubHeight + G.stubGap) + G.stubHeight / 2
    )
  }

  private renderFeatureStubs() {
    const entries = this.shownEntries
    const centres = this.stubCentres
    const lane = this.props.featureLane
    const { midY } = this.layout

    const withPr = lane.filter(e => e.pullRequestNumber !== null).length

    return (
      <g>
        {entries.map((entry, i) => {
          // Only treat a branch as idle when we actually know it has no pull
          // request. Without pull request data every branch would look idle.
          const idle =
            entry.pullRequestNumber === null &&
            this.props.pullRequestKnowledge === 'known'

          // The one stub whose name isn't a link, so it says why.
          const current = entry.branchName === this.props.currentBranchName

          return (
            <g key={entry.branchName}>
              <rect
                className={`hotflow-stub${idle ? ' idle' : ''}${
                  current ? ' current' : ''
                }`}
                x={featureX}
                y={centres[i] - G.stubHeight / 2}
                width={G.featureWidth}
                height={G.stubHeight}
                rx={4}
              />
              {/* The branch name is HTML, in the overlay — see renderBranchNames. */}
              <text
                className="hotflow-text xs dim"
                // Only branches with a pull request give up the right-hand slot
                // to the merge button; the rest keep the full width.
                x={
                  featureX +
                  G.featureWidth -
                  (entry.pullRequestNumber === null ? 10 : 32)
                }
                y={centres[i] + 4}
                textAnchor="end"
              >
                {this.getStubBadge(entry)}
              </text>
            </g>
          )
        })}

        {entries.length === 0 && (
          <text className="hotflow-text sm dim" x={featureX} y={midY + 4}>
            No open feature branches
          </text>
        )}

        <text
          className="hotflow-text xs dim"
          x={featureX}
          y={this.layout.height - G.padding - 4}
        >
          {this.getLaneCaption(lane.length, withPr, entries.length)}
        </text>
      </g>
    )
  }

  /** The right-hand marker on a stub: its pull request, or why we can't say. */
  private getStubBadge(entry: IFeatureLaneEntry): string {
    if (entry.pullRequestNumber !== null) {
      return `#${entry.pullRequestNumber}`
    }

    switch (this.props.pullRequestKnowledge) {
      case 'known':
        return 'No PR'
      case 'loading':
        return '…'
      default:
        // Say nothing rather than claim there's no pull request.
        return ''
    }
  }

  /**
   * Reports branches and pull requests separately, because they answer different
   * questions — a branch can be in flight with no pull request, and the two
   * counts routinely disagree.
   *
   * When pull request data isn't available the caption says so, rather than
   * reporting zero as though it were a finding.
   */
  private getLaneCaption(total: number, withPr: number, shown: number): string {
    if (total === 0) {
      return ''
    }

    const branches = `${total} ${total === 1 ? 'branch' : 'branches'}`
    const overflow = total > shown ? ` · showing ${shown}` : ''

    const prs =
      this.props.pullRequestKnowledge === 'unavailable'
        ? 'pull requests unavailable — sign in to GitHub'
        : this.props.pullRequestKnowledge === 'loading'
        ? 'loading pull requests…'
        : withPr === 0
        ? 'none with a pull request'
        : `${withPr} with a pull request`

    return `${branches} · ${prs} → ${this.integrationName}${overflow}`
  }

  private renderFeatureConnectors() {
    const centres = this.stubCentres
    const { midY } = this.layout

    // From the stubs' right edge to just short of the integration node.
    const from = featureRight
    const to = integrationX - edgeGap
    const bend = from + (to - from) / 2

    /** A stub at height `y` curving into the single point on integration. */
    const curve = (y: number) =>
      Math.abs(y - midY) < 0.5
        ? `M${from},${midY} L${to},${midY}`
        : `M${from},${y} C${bend},${y} ${bend},${midY} ${to},${midY}`

    if (centres.length === 0) {
      return <path className="hotflow-edge faint" d={curve(midY)} fill="none" />
    }

    // Only draw a connector faint when we know the branch has no pull request.
    // Without pull request data every connector would otherwise look idle.
    const isIdle = (i: number) =>
      this.shownEntries[i].pullRequestNumber === null &&
      this.props.pullRequestKnowledge === 'known'

    // The last solid connector carries the arrowhead, so the fan reads as one
    // flow into the integration branch rather than several arrows stacked up.
    const lastSolid = centres.reduce((last, _, i) => (isIdle(i) ? last : i), -1)

    return (
      <g>
        {centres.map((y, i) => {
          return (
            <path
              key={i}
              className={isIdle(i) ? 'hotflow-edge faint' : 'hotflow-edge'}
              d={curve(y)}
              fill="none"
              markerEnd={
                i === lastSolid ||
                (lastSolid === -1 && i === centres.length - 1)
                  ? 'url(#hotflow-arrow)'
                  : undefined
              }
            />
          )
        })}
      </g>
    )
  }

  private renderIntegrationNode() {
    const { unreleasedCommitCount } = this.props.hotFlowState
    const { midY } = this.layout

    return (
      <g>
        <rect
          className="hotflow-node"
          x={integrationX}
          y={midY - 28}
          width={G.integrationWidth}
          height={56}
          rx={6}
        />
        <text
          className="hotflow-text mono md strong"
          x={integrationX + 14}
          y={midY - 5}
        >
          {this.integrationName}
        </text>
        <text
          className="hotflow-text xs dim"
          x={integrationX + 14}
          y={midY + 14}
        >
          {unreleasedCommitCount === 0
            ? 'nothing unreleased'
            : `${unreleasedCommitCount} ${
                unreleasedCommitCount === 1 ? 'commit' : 'commits'
              } unreleased`}
        </text>
      </g>
    )
  }

  /**
   * The integration-to-release connector, carrying the drift state. This is the
   * most important edge in the diagram: amber here means "update the release".
   */
  private renderDriftEdge() {
    const release = this.props.hotFlowState.currentRelease
    const { midY } = this.layout

    const d = `M${integrationRight},${midY} L${releaseX - edgeGap},${midY}`

    if (release === null) {
      return <path className="hotflow-edge faint" d={d} fill="none" />
    }

    const behind = release.behindIntegration
    const isBehind = behind > 0

    // The pill sits centred under the edge it annotates.
    const pillWidth = isBehind ? 82 : 74
    const pillX = integrationRight + (G.driftEdge - edgeGap - pillWidth) / 2

    return (
      <g>
        <path
          className={isBehind ? 'hotflow-edge warn' : 'hotflow-edge'}
          d={d}
          fill="none"
          markerEnd={
            isBehind ? 'url(#hotflow-arrow-warn)' : 'url(#hotflow-arrow)'
          }
        />
        <rect
          className={isBehind ? 'hotflow-pill warn' : 'hotflow-pill ok'}
          x={pillX}
          y={midY + 10}
          width={pillWidth}
          height={20}
          rx={10}
        />
        <text
          className={`hotflow-text xs strong ${isBehind ? 'warn' : 'ok'}`}
          x={pillX + 10}
          y={midY + 24}
        >
          {isBehind ? `${behind} behind` : 'in sync'}
        </text>
      </g>
    )
  }

  private renderReleaseNode(release: IReleaseBranchState) {
    const { missingWorkItemCount } = this.props
    const { midY } = this.layout
    const isBehind = release.behindIntegration > 0
    const needsAttention = isBehind || missingWorkItemCount > 0

    const sequenceLabel =
      release.releaseSequence === null
        ? 'no sequence'
        : `seq ${release.releaseSequence.value}`

    return (
      <g>
        <rect
          className="hotflow-node focus"
          x={releaseX}
          y={midY - 42}
          width={G.releaseWidth}
          height={84}
          rx={6}
        />
        <rect
          className={`hotflow-pin ${needsAttention ? 'warn' : 'ok'}`}
          x={releaseX}
          y={midY - 42}
          width={3.5}
          height={84}
          rx={1.75}
        />
        <text
          className="hotflow-text mono md strong"
          x={releaseX + 16}
          y={midY - 17}
        >
          {truncate(`release/${release.version.raw}`, 28)}
        </text>
        <text className="hotflow-text xs dim" x={releaseX + 16} y={midY + 3}>
          {`${release.aheadOfProduction} ahead of ${this.productionName}`}
        </text>
        <text className="hotflow-text xs dim" x={releaseX + 16} y={midY + 20}>
          {`${release.vsoNumbers.length} work items · ${sequenceLabel}`}
        </text>
      </g>
    )
  }

  private renderNoReleaseNode() {
    const { midY } = this.layout

    return (
      <g>
        <rect
          className="hotflow-node empty"
          x={releaseX}
          y={midY - 28}
          width={G.releaseWidth}
          height={56}
          rx={6}
        />
        <text className="hotflow-text md dim" x={releaseX + 16} y={midY - 5}>
          No release branch
        </text>
        <text className="hotflow-text xs dim" x={releaseX + 16} y={midY + 14}>
          nothing waiting to ship
        </text>
      </g>
    )
  }

  private renderProductionEdge() {
    const release = this.props.hotFlowState.currentRelease
    const { midY } = this.layout

    const d = `M${releaseRight},${midY} L${productionX - edgeGap},${midY}`

    if (release === null) {
      return <path className="hotflow-edge faint" d={d} fill="none" />
    }

    const ready =
      release.behindIntegration === 0 && this.props.missingWorkItemCount === 0

    return (
      <g>
        <path
          className={ready ? 'hotflow-edge ok' : 'hotflow-edge'}
          d={d}
          fill="none"
          markerEnd={ready ? 'url(#hotflow-arrow-ok)' : 'url(#hotflow-arrow)'}
        />
        <text
          className={`hotflow-text xs ${ready ? 'ok strong' : 'dim'}`}
          x={releaseRight + 16}
          y={midY - 10}
        >
          {ready ? 'ready to ship' : 'merge + tag'}
        </text>
      </g>
    )
  }

  private renderProductionNode() {
    const { lastShippedVersion } = this.props
    const { midY } = this.layout

    return (
      <g>
        <rect
          className="hotflow-node"
          x={productionX}
          y={midY - 28}
          width={G.productionWidth}
          height={56}
          rx={6}
        />
        <text
          className="hotflow-text mono md strong"
          x={productionX + 14}
          y={midY - 5}
        >
          {this.productionName}
        </text>
        <text
          className="hotflow-text xs dim"
          x={productionX + 14}
          y={midY + 14}
        >
          {lastShippedVersion === null
            ? 'no release tags'
            : `last tag ${lastShippedVersion}`}
        </text>
      </g>
    )
  }
}

/** Trims a label to fit its box, with an ellipsis when it doesn't. */
function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`
}
