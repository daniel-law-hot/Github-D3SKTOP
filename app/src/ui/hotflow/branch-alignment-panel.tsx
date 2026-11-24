import * as React from 'react'
import classNames from 'classnames'
import { clipboard } from 'electron'
import {
  BranchAlignmentStatus,
  IAlignmentTag,
  IBranchAlignment,
  IReleaseAlignment,
} from '../../models/hotflow'
import { alignmentFixCommands } from '../../lib/hotflow/branch-alignment'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { LinkButton } from '../lib/link-button'

interface IBranchAlignmentPanelProps {
  readonly alignment: IBranchAlignment | null
  readonly integrationName: string
  readonly productionName: string
  readonly isLoading: boolean
}

interface IBranchAlignmentPanelState {
  readonly copied: boolean
}

/** The tab's marker: nothing when in line, otherwise how bad it is. */
export function alignmentIndicator(
  alignment: IBranchAlignment | null
): BranchAlignmentStatus | null {
  return alignment === null || alignment.status === 'aligned'
    ? null
    : alignment.status
}

/** `1.2026.24` -> `.24`: the part that tells neighbouring releases apart. */
function shortTag(name: string): string {
  const dot = name.lastIndexOf('.')

  return dot > 0 ? name.slice(dot) : name
}

// The diagram's coordinate space, at roughly the card's width so text is drawn
// near its real size. It scales down when the card is narrower.
const Width = 640
const Height = 186
const GutterX = 8
const LineStartX = 70
const OffY = 38
const TrunkY = 98
const ReleaseY = 150
const TagStartX = 96
const TagEndX = 410
const ReleaseForkX = 430
const ReleaseTipX = 476

/**
 * The part of the diagram worth showing.
 *
 * In line, there is no production lane above the trunk and no notes about a
 * split beneath it, so the top and the notes' room are cropped away and the
 * card gets shorter. Without a release the bottom lane goes too.
 */
function graphViewBox(status: BranchAlignmentStatus, hasRelease: boolean) {
  if (status !== 'aligned') {
    return `0 0 ${Width} ${Height}`
  }

  // Room above the trunk for the tag labels and the production pill.
  const top = TrunkY - 48
  const bottom = hasRelease ? ReleaseY + 36 : TrunkY + 14

  return `0 ${top} ${Width} ${bottom - top}`
}

/** Long commit subjects would run off the diagram. */
const MaxSummaryLength = 56

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/** A dot on production's lane: a shipped tag, or production's untagged tip. */
interface IGraphNode {
  readonly x: number
  readonly label: string
  readonly title: string
  readonly inIntegration: boolean
}

/**
 * Where each of production's dots sits. Exported for tests.
 *
 * Tags integration contains sit on integration's line, because that is what
 * being in line means. The rest sit on a lane of their own above it.
 * Production's tip gets a dot of its own when it is off the line with no
 * tag to show it, since a hotfix nobody tagged is the likeliest cause.
 */
export function layoutProductionNodes(
  tags: ReadonlyArray<IAlignmentTag>,
  status: BranchAlignmentStatus
): ReadonlyArray<IGraphNode> {
  const nodes: Array<Omit<IGraphNode, 'x'>> = tags.map(t => ({
    label: shortTag(t.name),
    title: t.name,
    inIntegration: t.inIntegration,
  }))

  const anyUnaligned = tags.some(t => !t.inIntegration)

  if (status !== 'aligned' && !anyUnaligned) {
    nodes.push({ label: 'tip', title: 'Untagged tip', inIntegration: false })
  }

  const step =
    nodes.length <= 1 ? 0 : (TagEndX - TagStartX) / (nodes.length - 1)

  return nodes.map((n, i) => ({ ...n, x: TagStartX + step * i }))
}

/**
 * Whether production, the current release and integration are still in line,
 * drawn and then spelled out.
 *
 * In line, production's tags sit on integration's line. Out of line,
 * production lifts onto a lane of its own from the first tag integration lacks.
 * That is the picture of what happened in AmadeusWebApi, where main could
 * never fast-forward again after 1.2026.24.
 */
export class BranchAlignmentPanel extends React.Component<
  IBranchAlignmentPanelProps,
  IBranchAlignmentPanelState
> {
  public constructor(props: IBranchAlignmentPanelProps) {
    super(props)
    this.state = { copied: false }
  }

  public render() {
    const { alignment, isLoading } = this.props

    if (alignment === null) {
      return (
        <div className="hotflow-align">
          <h3 className="hotflow-summary-heading">Branches</h3>
          <p className="hotflow-align-muted">
            {isLoading
              ? 'Working out how the branches line up…'
              : "Couldn't work out how the branches line up."}
          </p>
        </div>
      )
    }

    const release = this.renderRelease(alignment)
    const fix = this.renderFix(alignment)

    return (
      <div className="hotflow-align">
        <h3 className="hotflow-summary-heading">Branches</h3>
        {this.renderHeadline(alignment)}
        {/* The graph across the top, then the release and the fix side by side
          beneath it. They stack when the card is too narrow for both. */}
        <div className="hotflow-align-grid">
          <div className="hotflow-align-graph-cell">
            {this.renderGraph(alignment)}
          </div>
          {release !== null && (
            <div
              className={classNames('hotflow-align-cell', 'left', {
                full: fix === null,
              })}
            >
              {release}
            </div>
          )}
          {fix !== null && (
            <div className="hotflow-align-cell right">{fix}</div>
          )}
        </div>
        {/* With a fix to show, this sits beside its copy link instead. */}
        {fix === null && this.renderFootnote()}
      </div>
    )
  }

  private renderHeadline(alignment: IBranchAlignment) {
    const { integrationName: dev, productionName: prod } = this.props
    const { status } = alignment
    const count = alignment.productionOnlyCommits.length
    const counted = `${count}${alignment.productionOnlyCapped ? '+' : ''} ${
      count === 1 ? 'commit is' : 'commits are'
    }`
    const allMerges = alignment.strandedCommits.length === 0
    const mergeBack = alignment.mergeBack
    const affected = mergeBack?.files.length ?? 0

    const [icon, title, detail] =
      status === 'aligned'
        ? [
            octicons.checkCircleFill,
            `${prod} is in line with ${dev}`,
            `${dev} contains everything on ${prod}, so each release can fast-forward onto it.`,
          ]
        : status === 'out-of-line'
        ? [
            octicons.alertFill,
            `${prod} has drifted off ${dev}`,
            `${counted} on ${prod} but not ${dev}, ${
              allMerges ? 'all of them merges' : 'copies of work it already has'
            }. No code is missing, but ${prod} can't fast-forward any more, and every tag since ${
              alignment.firstUnalignedTag ?? 'then'
            } sits outside ${dev}'s history.`,
          ]
        : [
            octicons.xCircleFill,
            `Work on ${prod} is missing from ${dev}`,
            mergeBack === null
              ? `${counted} on ${prod} and not ${dev}, and some carry changes of their own.`
              : mergeBack.outcome === 'conflicts'
              ? `Merging ${prod} back into ${dev} would conflict in ${affected} ${
                  affected === 1 ? 'file' : 'files'
                }. The two have each changed the same code.`
              : `Merging ${prod} back into ${dev} would change ${affected} ${
                  affected === 1 ? 'file' : 'files'
                }, so ${dev} and every release cut from it lack that work.`,
          ]

    return (
      <div className={classNames('hotflow-align-headline', status)}>
        <Octicon symbol={icon} className="hotflow-align-headline-icon" />
        <div>
          <div className="hotflow-align-headline-title">{title}</div>
          <div className="hotflow-align-headline-detail">{detail}</div>
        </div>
      </div>
    )
  }

  /**
   * The lanes, with the facts that matter written where they happened: the last
   * tag still in line, where production left, how much is only on production,
   * the first commit off the line, and how the release stands.
   */
  private renderGraph(alignment: IBranchAlignment) {
    const { integrationName: dev, productionName: prod } = this.props
    const { status, release } = alignment
    const nodes = layoutProductionNodes(alignment.recentTags, status)

    const aligned = nodes.filter(n => n.inIntegration)
    const off = nodes.filter(n => !n.inIntegration)

    // Production leaves integration's line at the last tag it shares, or from
    // the start when it shares none in view.
    const splitX =
      aligned.length > 0 ? aligned[aligned.length - 1].x : TagStartX - 16
    const offStartX = off.length > 0 ? off[0].x : splitX
    const offEndX = off.length > 0 ? off[off.length - 1].x + 18 : splitX
    const bend = Math.max(12, (offStartX - splitX) * 0.6)

    const offPath =
      off.length === 0
        ? null
        : `M ${splitX} ${TrunkY} C ${splitX + bend} ${TrunkY}, ${
            offStartX - bend
          } ${OffY}, ${offStartX} ${OffY} L ${offEndX} ${OffY}`

    // Notes under the split read left to right from it, unless it's far enough
    // right that they'd run into the release; then they read leftwards.
    const notesAnchor = splitX < Width / 2 ? 'start' : 'end'
    const notesX = notesAnchor === 'start' ? splitX - 4 : splitX + 4

    const commits = alignment.productionOnlyCommits
    const firstOff =
      alignment.productionOnlyCapped || commits.length === 0
        ? null
        : commits[commits.length - 1]
    const onlyCount = `${commits.length}${
      alignment.productionOnlyCapped ? '+' : ''
    } ${commits.length === 1 ? 'commit' : 'commits'} only on ${prod}`

    const newest = nodes.length > 0 ? nodes[nodes.length - 1] : null

    return (
      <svg
        className={classNames('hotflow-align-graph', status)}
        viewBox={graphViewBox(status, release !== null)}
        role="img"
        aria-label={
          status === 'aligned'
            ? `${prod} sits on ${dev}'s line`
            : `${prod} has split from ${dev}${
                alignment.firstUnalignedTag
                  ? ` since ${alignment.firstUnalignedTag}`
                  : ''
              }`
        }
      >
        {/* Lane names, in a gutter of their own. */}
        {off.length > 0 && (
          <text
            className="hotflow-align-lane-name off"
            x={GutterX}
            y={OffY + 4}
          >
            {prod}
          </text>
        )}
        <text className="hotflow-align-lane-name" x={GutterX} y={TrunkY + 4}>
          {dev}
        </text>
        {release !== null && (
          <text
            className="hotflow-align-lane-name"
            x={GutterX}
            y={ReleaseY + 4}
          >
            release
          </text>
        )}

        {/* Integration: the trunk everything comes from. */}
        <line
          className="hotflow-align-trunk"
          x1={LineStartX}
          y1={TrunkY}
          x2={Width - 6}
          y2={TrunkY}
        />

        {offPath !== null && (
          <>
            <path className="hotflow-align-off" d={offPath} />
            {/* The gap between the two lines, marked at its far end. */}
            <line
              className="hotflow-align-gap"
              x1={offEndX - 6}
              y1={OffY + 9}
              x2={offEndX - 6}
              y2={TrunkY - 9}
            />
            <text
              className="hotflow-align-note strong"
              x={offEndX + 8}
              y={OffY + 4}
            >
              {onlyCount}
            </text>
            {alignment.firstUnalignedTag !== null && (
              <text
                className="hotflow-align-note warn"
                x={offStartX - 6}
                y={OffY - 14}
              >
                {`off since ${alignment.firstUnalignedTag}`}
              </text>
            )}
          </>
        )}

        {release !== null && this.renderReleaseLane(release)}

        {nodes.map(n => {
          const y = n.inIntegration ? TrunkY : OffY

          return (
            <g key={n.title}>
              <circle
                className={classNames('hotflow-align-dot', {
                  off: !n.inIntegration,
                  bad: !n.inIntegration && status === 'stranded',
                })}
                cx={n.x}
                cy={y}
                r={5}
              >
                <title>
                  {n.inIntegration
                    ? `${n.title} is in ${dev}`
                    : `${n.title} is not in ${dev}`}
                </title>
              </circle>
              <text
                className="hotflow-align-tag"
                x={n.x}
                y={n.inIntegration ? y - 12 : y + 19}
                textAnchor="middle"
              >
                {n.label}
              </text>
            </g>
          )
        })}

        {/* In line, production is simply the newest tag on the trunk. */}
        {status === 'aligned' && newest !== null && (
          <g transform={`translate(${newest.x}, ${TrunkY - 34})`}>
            <rect
              className="hotflow-align-pill aligned"
              x={-20}
              y={-8}
              width={40}
              height={15}
              rx={7.5}
            />
            <text
              className="hotflow-align-pill-text"
              x={0}
              y={3}
              textAnchor="middle"
            >
              {prod}
            </text>
          </g>
        )}

        {/* What happened at the split, under the trunk where there's room. */}
        {status !== 'aligned' && (
          <>
            {alignment.lastAlignedTag !== null && (
              <text
                className="hotflow-align-note"
                x={notesX}
                y={TrunkY + 24}
                textAnchor={notesAnchor}
              >
                {`last in line: ${alignment.lastAlignedTag}`}
              </text>
            )}
            {firstOff !== null && (
              <text
                className="hotflow-align-note"
                x={notesX}
                y={TrunkY + 39}
                textAnchor={notesAnchor}
              >
                <tspan className="hotflow-align-note-sha">
                  {firstOff.shortSha}
                </tspan>
                {` ${firstOff.author.name} · ${formatDay(
                  firstOff.author.date
                )}`}
                <title>{firstOff.summary}</title>
              </text>
            )}
            {firstOff !== null && (
              <text
                className="hotflow-align-note muted"
                x={notesX}
                y={TrunkY + 53}
                textAnchor={notesAnchor}
              >
                {truncate(firstOff.summary, MaxSummaryLength)}
              </text>
            )}
          </>
        )}
      </svg>
    )
  }

  /** The release's branch off the trunk, named, with how it stands. */
  private renderReleaseLane(release: IReleaseAlignment) {
    const { integrationName: dev, productionName: prod } = this.props
    const behind =
      release.behindIntegration === 0
        ? `up to date with ${dev}`
        : `${release.behindIntegration} behind ${dev}`

    return (
      <>
        <path
          className="hotflow-align-release"
          d={`M ${ReleaseForkX} ${TrunkY} C ${ReleaseForkX + 20} ${TrunkY}, ${
            ReleaseTipX - 24
          } ${ReleaseY}, ${ReleaseTipX} ${ReleaseY}`}
        />
        <circle
          className={classNames('hotflow-align-dot', 'release', {
            warn: !release.containsProduction,
          })}
          cx={ReleaseTipX}
          cy={ReleaseY}
          r={5}
        >
          <title>{release.branchName}</title>
        </circle>
        <text
          className="hotflow-align-note strong"
          x={ReleaseTipX + 12}
          y={ReleaseY + 1}
        >
          {release.branchName}
        </text>
        <text
          className={classNames('hotflow-align-note', {
            warn: !release.containsProduction,
          })}
          x={ReleaseTipX + 12}
          y={ReleaseY + 16}
        >
          {release.containsProduction
            ? `contains ${prod}`
            : `needs a merge into ${prod}`}
        </text>
        <text
          className="hotflow-align-note muted"
          x={ReleaseTipX + 12}
          y={ReleaseY + 30}
        >
          {behind}
        </text>
      </>
    )
  }

  private renderRelease(alignment: IBranchAlignment) {
    const { release } = alignment
    const { integrationName: dev, productionName: prod } = this.props

    if (release === null) {
      return null
    }

    return (
      <div className="hotflow-align-release-facts">
        <div className="hotflow-align-subheading">{release.branchName}</div>
        {/* In line, the checks are all good news and short, so they share a
          row rather than stacking into a column nobody needs to read down. */}
        <ul
          className={classNames('hotflow-align-checks', {
            inline: alignment.status === 'aligned',
          })}
        >
          <li className={release.containsProduction ? 'ok' : 'warn'}>
            <Octicon
              symbol={
                release.containsProduction ? octicons.check : octicons.alert
              }
            />
            {release.containsProduction
              ? `Contains ${prod}, so shipping fast-forwards`
              : `Doesn't contain ${prod}, so shipping adds another merge commit to ${prod}`}
          </li>
          <li className={release.behindIntegration === 0 ? 'ok' : 'info'}>
            <Octicon
              symbol={
                release.behindIntegration === 0
                  ? octicons.check
                  : octicons.gitMerge
              }
            />
            {release.behindIntegration === 0
              ? `Up to date with ${dev}`
              : `${release.behindIntegration} ${
                  release.behindIntegration === 1 ? 'commit' : 'commits'
                } behind ${dev}`}
          </li>
          {release.notInIntegrationCount > 0 && (
            <li className="warn">
              <Octicon symbol={octicons.alert} />
              {`${release.notInIntegrationCount} ${
                release.notInIntegrationCount === 1 ? 'commit' : 'commits'
              } not in ${dev} yet`}
            </li>
          )}
        </ul>
      </div>
    )
  }

  private renderFix(alignment: IBranchAlignment) {
    if (alignment.status === 'aligned') {
      return null
    }

    const { integrationName: dev, productionName: prod } = this.props
    const commands = alignmentFixCommands(dev, prod)

    return (
      <div className="hotflow-align-fix">
        <div className="hotflow-align-subheading">How to fix</div>
        <p>
          {alignment.status === 'out-of-line'
            ? `Merge ${prod} into ${dev}. No files change, and ${prod} can fast-forward again.`
            : alignment.mergeBack?.outcome === 'conflicts'
            ? `Merge ${prod} into ${dev} and resolve the conflicts with whoever changed ${prod}.`
            : `Merge ${prod} into ${dev}, and review what it brings across before pushing.`}
        </p>
        <pre className="hotflow-command-block">{commands.join('\n')}</pre>
        {/* The caveat shares the copy link's line rather than taking one of its
          own, which is the line the card needed to stop scrolling. */}
        <div className="hotflow-command-actions hotflow-align-fix-actions">
          <LinkButton onClick={this.onCopy}>
            <Octicon symbol={octicons.copy} />{' '}
            {this.state.copied ? 'Copied' : 'Copy commands'}
          </LinkButton>
          {this.renderFootnote()}
        </div>
      </div>
    )
  }

  private renderFootnote() {
    return (
      <span className="hotflow-align-muted hotflow-align-footnote">
        Measured against the remote branches as of the last fetch.
      </span>
    )
  }

  private onCopy = () => {
    clipboard.writeText(
      alignmentFixCommands(
        this.props.integrationName,
        this.props.productionName
      ).join('\n')
    )
    this.setState({ copied: true })
  }
}
