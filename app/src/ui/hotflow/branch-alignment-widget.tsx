import * as React from 'react'
import classNames from 'classnames'
import { IBranchAlignment } from '../../models/hotflow'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  alignmentIndicator,
  BranchAlignmentPanel,
} from './branch-alignment-panel'

interface IBranchAlignmentWidgetProps {
  readonly alignment: IBranchAlignment | null
  readonly integrationName: string
  readonly productionName: string
  readonly isLoading: boolean
}

interface IBranchAlignmentWidgetState {
  readonly expanded: boolean
}

/**
 * What the button is called aloud. The marker on it is decoration, so its
 * meaning is carried here instead.
 */
function buttonLabel(alignment: IBranchAlignment | null): string {
  switch (alignmentIndicator(alignment)) {
    case 'stranded':
      return 'Branches: work is missing from the integration branch'
    case 'out-of-line':
      return 'Branches: production has drifted off the integration branch'
    default:
      return 'Branches: are production, the release and integration in line?'
  }
}

/**
 * A button in the corner of the flow band that opens into the branch alignment
 * card.
 *
 * It sits over the diagram because alignment is a question about the flow the
 * diagram draws: feature, develop, release, main. Kept folded by default so the
 * diagram keeps its room. The marker on the button says whether there is
 * anything worth opening it for.
 */
export class BranchAlignmentWidget extends React.Component<
  IBranchAlignmentWidgetProps,
  IBranchAlignmentWidgetState
> {
  private rootRef = React.createRef<HTMLDivElement>()
  private toggleRef = React.createRef<HTMLButtonElement>()
  private closeRef = React.createRef<HTMLButtonElement>()

  public constructor(props: IBranchAlignmentWidgetProps) {
    super(props)
    this.state = { expanded: false }
  }

  public componentDidUpdate(
    prevProps: IBranchAlignmentWidgetProps,
    prevState: IBranchAlignmentWidgetState
  ) {
    if (prevState.expanded === this.state.expanded) {
      return
    }

    if (this.state.expanded) {
      document.addEventListener('mousedown', this.onDocumentMouseDown)
      document.addEventListener('keydown', this.onDocumentKeyDown)
      this.closeRef.current?.focus()
    } else {
      this.removeListeners()
    }
  }

  public componentWillUnmount() {
    this.removeListeners()
  }

  private removeListeners() {
    document.removeEventListener('mousedown', this.onDocumentMouseDown)
    document.removeEventListener('keydown', this.onDocumentKeyDown)
  }

  /** A click anywhere outside the card folds it away. */
  private onDocumentMouseDown = (event: MouseEvent) => {
    const root = this.rootRef.current

    if (
      root !== null &&
      event.target instanceof Node &&
      !root.contains(event.target)
    ) {
      this.setState({ expanded: false })
    }
  }

  private onDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      this.collapse()
    }
  }

  private onToggle = () => {
    this.setState(s => ({ expanded: !s.expanded }))
  }

  /** Folds away and hands focus back to the button that opened it. */
  private collapse = () => {
    this.setState({ expanded: false }, () => this.toggleRef.current?.focus())
  }

  private renderIndicator() {
    const indicator = alignmentIndicator(this.props.alignment)

    return indicator === null ? null : (
      <span
        className={classNames('hotflow-align-indicator', indicator)}
        aria-hidden="true"
      >
        !
      </span>
    )
  }

  public render() {
    const { expanded } = this.state
    const { alignment } = this.props
    const indicator = alignmentIndicator(alignment)

    return (
      <div
        ref={this.rootRef}
        className={classNames('hotflow-align-widget', { expanded })}
      >
        <button
          ref={this.toggleRef}
          type="button"
          className={classNames('hotflow-align-toggle', indicator ?? 'aligned')}
          aria-label={buttonLabel(alignment)}
          aria-expanded={expanded}
          aria-controls="hotflow-align-card"
          onClick={this.onToggle}
        >
          <Octicon symbol={octicons.gitBranch} title={buttonLabel(alignment)} />
          {this.renderIndicator()}
        </button>

        {expanded && (
          <div
            className={classNames('hotflow-align-card', {
              // In line, there's nothing to fix and no reason to fill the band.
              compact: alignmentIndicator(alignment) === null,
            })}
            id="hotflow-align-card"
            role="dialog"
            aria-label="Branch alignment"
          >
            <button
              ref={this.closeRef}
              type="button"
              className="hotflow-align-close"
              aria-label="Close branch alignment"
              onClick={this.collapse}
            >
              <Octicon symbol={octicons.x} />
            </button>
            <BranchAlignmentPanel
              alignment={alignment}
              integrationName={this.props.integrationName}
              productionName={this.props.productionName}
              isLoading={this.props.isLoading}
            />
          </div>
        )}
      </div>
    )
  }
}
