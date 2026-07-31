import * as React from 'react'
import { clamp } from '../../lib/clamp'
import { getNumber, setNumber } from '../../lib/local-storage'
import { minDiagramHeight } from './flow-diagram'

/**
 * A horizontal drag bar for resizing the flow band above it.
 *
 * Desktop's own `Resizable` handles width only, and its keyboard and aria
 * plumbing is written in terms of width, so this is a small dedicated vertical
 * equivalent rather than a rework of shared code.
 */

const storageKey = 'hotflow-flow-band-height'

/**
 * Everything in the band that isn't the diagram, mirroring `.hotflow-flow-band`
 * in `_hotflow.scss`:
 *
 *   10  padding-top          --spacing
 *    5  padding-bottom       --spacing-half
 *    5  gap above the actions --spacing-half
 *   25  the action row        --button-height
 *   12  horizontal scrollbar  the diagram is always wider than the panel
 *
 * Shared with `maxStubs` so the row count and the minimum height are derived from
 * the same number rather than two guesses at it.
 */
export const FlowBandChromeHeight = 57

/**
 * The floor is the diagram's own minimum plus the chrome, because below that the
 * diagram has already bottomed out and the only thing left to give is the action
 * row — which the band's `overflow: hidden` then clips, hiding Start feature and
 * the rest with no indication they're there.
 */
const MinFlowBandHeight = minDiagramHeight + FlowBandChromeHeight

export const DefaultFlowBandHeight = 260
const MaxFlowBandHeight = 700

/** Nudge per arrow keypress. */
const KeyboardStep = 12

/** The remembered band height, clamped in case the stored value is stale. */
export function getStoredFlowBandHeight(): number {
  return clampFlowBandHeight(getNumber(storageKey, DefaultFlowBandHeight))
}

export function clampFlowBandHeight(height: number): number {
  return clamp(height, MinFlowBandHeight, MaxFlowBandHeight)
}

export function storeFlowBandHeight(height: number): void {
  setNumber(storageKey, height)
}

interface IFlowBandResizerProps {
  readonly height: number

  /** Called continuously while dragging, with an already-clamped height. */
  readonly onHeightChanged: (height: number) => void

  /** Called on double-click, to restore the default height. */
  readonly onReset: () => void
}

export class FlowBandResizer extends React.Component<IFlowBandResizerProps> {
  /** Where the drag started, so movement is relative rather than absolute. */
  private dragStartY: number | null = null
  private dragStartHeight = 0

  public componentWillUnmount() {
    this.removeDragListeners()
  }

  public render() {
    return (
      // A plain button, matching how Desktop's own Resizable renders its handle.
      // The ARIA splitter pattern would be a better fit semantically, but the
      // separator role can't sit on an interactive element, so the current size
      // goes in the label instead.
      <button
        type="button"
        className="hotflow-band-resizer"
        aria-label={`Resize the flow diagram. Currently ${Math.round(
          this.props.height
        )} pixels tall. Use the up and down arrow keys to adjust.`}
        onMouseDown={this.onMouseDown}
        onDoubleClick={this.props.onReset}
        onKeyDown={this.onKeyDown}
      >
        <span className="hotflow-band-resizer-grip" />
      </button>
    )
  }

  private onMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    // Only the primary button drags.
    if (event.button !== 0) {
      return
    }

    event.preventDefault()

    this.dragStartY = event.clientY
    this.dragStartHeight = this.props.height

    // Listen on the document so the drag survives the pointer leaving the grip.
    document.addEventListener('mousemove', this.onDocumentMouseMove)
    document.addEventListener('mouseup', this.onDocumentMouseUp)
  }

  private onDocumentMouseMove = (event: MouseEvent) => {
    if (this.dragStartY === null) {
      return
    }

    const delta = event.clientY - this.dragStartY

    this.props.onHeightChanged(
      clampFlowBandHeight(this.dragStartHeight + delta)
    )
  }

  private onDocumentMouseUp = () => {
    this.dragStartY = null
    this.removeDragListeners()
    storeFlowBandHeight(this.props.height)
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

    const next = clampFlowBandHeight(
      this.props.height + direction * KeyboardStep
    )

    this.props.onHeightChanged(next)
    storeFlowBandHeight(next)
  }
}
