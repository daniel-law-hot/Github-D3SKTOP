import * as React from 'react'
import classNames from 'classnames'
import { clamp } from '../../lib/clamp'
import { getNumber, setNumber } from '../../lib/local-storage'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'

type SidePanelTab = 'release' | 'notifications'

const storageKey = 'hotflow-side-pipeline-earlier'

/** Earlier releases shown under each pipeline until the user chooses otherwise. */
export const DefaultEarlierCount = 3

/** What the cycle info below is always left, however far the divider is pulled. */
export const MinSummaryHeight = 120

/** One release row's height, for when there is none on screen to measure. */
const FallbackRowHeight = 32

/**
 * The count a drag arrives at: whole releases, from how far the divider has
 * travelled. Moving in jumps is what keeps the area exactly as tall as its
 * content. Exported for tests.
 */
export function earlierCountForDrag(
  startCount: number,
  deltaPixels: number,
  stepPixels: number,
  max: number
): number {
  const step = Math.max(1, stepPixels)

  return clamp(startCount + Math.round(deltaPixels / step), 0, Math.max(0, max))
}

/** What the user last chose, or null if they never have. */
function getStoredEarlierCount(): number | null {
  const stored = getNumber(storageKey, -1)

  return stored >= 0 ? stored : null
}

interface ISplitterProps {
  /** How many earlier releases are showing now. */
  readonly count: number

  /** The most that can be shown: what there is, and what the panel has room for. */
  readonly getMax: () => number

  /** What one more release adds to the height: a row for each pipeline. */
  readonly getStepPixels: () => number
  readonly onCountChanged: (count: number) => void
  readonly onReset: () => void
}

/**
 * The handle between the release pipeline and the cycle info beneath it.
 *
 * Built like the flow band's resizer, for the same reasons: a button so it can be
 * focused and reached by keyboard, with the state in the label. It moves in whole
 * releases rather than pixels.
 */
class PipelineSplitter extends React.Component<ISplitterProps> {
  private dragStartY: number | null = null
  private dragStartCount = 0
  private dragStepPixels = 1
  private dragMax = 0

  public componentWillUnmount() {
    this.removeDragListeners()
  }

  public render() {
    const { count } = this.props

    return (
      <button
        type="button"
        className="hotflow-side-splitter"
        aria-label={`Resize the release pipeline. Showing ${count} earlier ${
          count === 1 ? 'release' : 'releases'
        }. Use the up and down arrow keys to adjust, or double click to reset.`}
        onMouseDown={this.onMouseDown}
        onDoubleClick={this.props.onReset}
        onKeyDown={this.onKeyDown}
      >
        <span className="hotflow-side-splitter-grip" />
      </button>
    )
  }

  private onMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()

    this.dragStartY = event.clientY
    this.dragStartCount = this.props.count
    this.dragStepPixels = this.props.getStepPixels()
    this.dragMax = this.props.getMax()

    document.addEventListener('mousemove', this.onDocumentMouseMove)
    document.addEventListener('mouseup', this.onDocumentMouseUp)
  }

  private onDocumentMouseMove = (event: MouseEvent) => {
    if (this.dragStartY === null) {
      return
    }

    const next = earlierCountForDrag(
      this.dragStartCount,
      event.clientY - this.dragStartY,
      this.dragStepPixels,
      this.dragMax
    )

    if (next !== this.props.count) {
      this.props.onCountChanged(next)
    }
  }

  private onDocumentMouseUp = () => {
    this.dragStartY = null
    this.removeDragListeners()
  }

  private removeDragListeners() {
    document.removeEventListener('mousemove', this.onDocumentMouseMove)
    document.removeEventListener('mouseup', this.onDocumentMouseUp)
  }

  private onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const direction =
      event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0

    if (direction === 0) {
      return
    }

    event.preventDefault()

    this.props.onCountChanged(
      clamp(this.props.count + direction, 0, Math.max(0, this.props.getMax()))
    )
  }
}

interface ISidePanelProps {
  /** How many things are waiting on the user, shown on the Notifications tab. */
  readonly notificationCount: number

  /** Whether there is a pipeline to show; without one the facts get the room. */
  readonly showPipeline: boolean

  /** How many pipelines there are, which is how many rows one more release adds. */
  readonly pipelineCount: number

  /** The most earlier releases any pipeline has, so the divider stops there. */
  readonly maxEarlierReleases: number

  /** Draws the pipeline showing this many earlier releases under each. */
  readonly renderPipeline: (earlierCount: number) => JSX.Element
  readonly renderSummary: () => JSX.Element
  readonly renderNotifications: () => JSX.Element

  /** Folded away to a thin bar, so the diagram and the work items get the room. */
  readonly collapsed: boolean
  readonly onCollapsedChanged: (collapsed: boolean) => void
}

interface ISidePanelState {
  readonly tab: SidePanelTab

  /** What the user chose, or null for the default. */
  readonly earlierCount: number | null
}

/**
 * The right-hand column, full height from the very top, with a tab for the
 * release and one for anything that wants the user's attention.
 *
 * Both panes stay mounted and the inactive one is hidden, so a half-typed approval
 * comment or a scroll position survives a trip to the other tab — and to the thin
 * bar, which only hides the panel rather than taking it down.
 */
export class SidePanel extends React.Component<
  ISidePanelProps,
  ISidePanelState
> {
  private releaseRef = React.createRef<HTMLDivElement>()
  private pipelineRef = React.createRef<HTMLDivElement>()

  public constructor(props: ISidePanelProps) {
    super(props)
    this.state = { tab: 'release', earlierCount: getStoredEarlierCount() }
  }

  private onSelect = (tab: SidePanelTab) => () => {
    this.setState({ tab })
  }

  /** From the thin bar: opens the panel on the tab that was pressed. */
  private onExpandTo = (tab: SidePanelTab) => () => {
    this.setState({ tab })
    this.props.onCollapsedChanged(false)
  }

  private onCollapse = () => {
    this.props.onCollapsedChanged(true)
  }

  private onExpand = () => {
    this.props.onCollapsedChanged(false)
  }

  /** What one more release adds: a row's measured height for each pipeline. */
  private getStepPixels = (): number => {
    const row = this.pipelineRef.current?.querySelector<HTMLElement>(
      '.hotflow-pl-earlier .hotflow-pl-row:not(.hotflow-pl-legend)'
    )

    return (
      (row?.offsetHeight ?? FallbackRowHeight) *
      Math.max(1, this.props.pipelineCount)
    )
  }

  /**
   * The most that can be shown: what there is, and what fits while the cycle info
   * keeps its minimum. Measured, because the room depends on the window.
   */
  private getMax = (): number => {
    const release = this.releaseRef.current
    const pipeline = this.pipelineRef.current

    if (release === null || pipeline === null) {
      return this.props.maxEarlierReleases
    }

    const spare =
      release.clientHeight - MinSummaryHeight - pipeline.offsetHeight
    const room = this.effectiveCount + Math.floor(spare / this.getStepPixels())

    return Math.max(0, Math.min(this.props.maxEarlierReleases, room))
  }

  private onCountChanged = (earlierCount: number) => {
    this.setState({ earlierCount })
    setNumber(storageKey, earlierCount)
  }

  private onCountReset = () => {
    this.setState({ earlierCount: null })
    setNumber(storageKey, -1)
  }

  /** The count in use: the choice, or the default, never past what there is. */
  private get effectiveCount(): number {
    return Math.min(
      this.state.earlierCount ?? DefaultEarlierCount,
      this.props.maxEarlierReleases
    )
  }

  private renderTab(tab: SidePanelTab, label: string, count?: number) {
    const selected = this.state.tab === tab

    return (
      <button
        type="button"
        role="tab"
        id={`hotflow-side-tab-${tab}`}
        aria-selected={selected}
        aria-controls={`hotflow-side-pane-${tab}`}
        className={classNames('hotflow-side-tab', { selected })}
        onClick={this.onSelect(tab)}
      >
        {label}
        {count !== undefined && count > 0 && (
          <span className="hotflow-side-badge">{count}</span>
        )}
      </button>
    )
  }

  private renderRelease() {
    const { showPipeline } = this.props
    const count = this.effectiveCount

    return (
      <div
        ref={this.releaseRef}
        className="hotflow-side-release"
        role="tabpanel"
        id="hotflow-side-pane-release"
        aria-labelledby="hotflow-side-tab-release"
        hidden={this.state.tab !== 'release'}
      >
        {showPipeline && (
          <>
            <div ref={this.pipelineRef} className="hotflow-side-pipeline">
              {this.props.renderPipeline(count)}
            </div>
            <PipelineSplitter
              count={count}
              getMax={this.getMax}
              getStepPixels={this.getStepPixels}
              onCountChanged={this.onCountChanged}
              onReset={this.onCountReset}
            />
          </>
        )}
        <div className="hotflow-side-summary">{this.props.renderSummary()}</div>
      </div>
    )
  }

  /**
   * What is left when the panel is folded away: a thin bar with the way back, and
   * each tab as a vertical label so the Notifications count is still in sight.
   */
  private renderCollapsed() {
    const count = this.props.notificationCount

    return (
      <div className="hotflow-side-rail">
        <button
          type="button"
          className="hotflow-side-fold"
          aria-label="Show the side panel"
          onClick={this.onExpand}
        >
          <Octicon symbol={octicons.chevronLeft} />
        </button>
        <button
          type="button"
          className="hotflow-side-rail-tab"
          onClick={this.onExpandTo('release')}
        >
          This release
        </button>
        <button
          type="button"
          className="hotflow-side-rail-tab"
          onClick={this.onExpandTo('notifications')}
        >
          Notifications
          {count > 0 && <span className="hotflow-side-badge">{count}</span>}
        </button>
      </div>
    )
  }

  public render() {
    const { collapsed } = this.props

    return (
      <aside className={classNames('hotflow-side', { collapsed })}>
        {collapsed && this.renderCollapsed()}
        <div className="hotflow-side-body" hidden={collapsed}>
          <div className="hotflow-side-tabs" role="tablist">
            {this.renderTab('release', 'This release')}
            {this.renderTab(
              'notifications',
              'Notifications',
              this.props.notificationCount
            )}
            <button
              type="button"
              className="hotflow-side-fold"
              aria-label="Fold the side panel away"
              onClick={this.onCollapse}
            >
              <Octicon symbol={octicons.chevronRight} />
            </button>
          </div>

          {this.renderRelease()}
          <div
            className="hotflow-side-notifications"
            role="tabpanel"
            id="hotflow-side-pane-notifications"
            aria-labelledby="hotflow-side-tab-notifications"
            hidden={this.state.tab !== 'notifications'}
          >
            {this.props.renderNotifications()}
          </div>
        </div>
      </aside>
    )
  }
}
