import * as React from 'react'
import { clamp } from '../../lib/clamp'
import { getNumber, setNumber } from '../../lib/local-storage'

/**
 * A horizontal drag bar for resizing the flow band above it.
 *
 * Desktop's own `Resizable` handles width only, and its keyboard and aria
 * plumbing is written in terms of width, so this is a small dedicated vertical
 * equivalent rather than a rework of shared code.
 */

const storageKey = 'hotflow-flow-band-height'

export const DefaultFlowBandHeight = 260
const MinFlowBandHeight = 150
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
