import * as React from 'react'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import {
  ChangesDiffPane,
  ChangesSidebarPane,
  IChangesPaneProps,
} from '../changes/changes-pane'
import { Resizable } from '../resizable'
import { clamp } from '../../lib/clamp'
import { getNumber, setNumber } from '../../lib/local-storage'

/**
 * The width of the file list, remembered separately from the repository view's
 * sidebar.
 *
 * Deliberately its own setting: HotFlow gives the diff the whole window rather than
 * the two thirds the repository view leaves it, so the width that reads well here
 * isn't the width that reads well there, and dragging one shouldn't move the other.
 */
const storageKey = 'hotflow-branch-changes-width'

const DefaultWidth = 250
const MinWidth = 200
const MaxWidth = 550

function clampWidth(width: number): number {
  return clamp(width, MinWidth, MaxWidth)
}

interface IBranchChangesProps {
  readonly changesPaneProps: IChangesPaneProps

  /** The branch whose changes these are, for the empty state's copy. */
  readonly branchName: string | null
}

interface IBranchChangesState {
  readonly width: number

  /** Keeps the list's scroll position across re-renders of the tab. */
  readonly scrollTop?: number
}

/**
 * The working directory, inside HotFlow.
 *
 * The same file list, diff and commit form as the repository view's Changes
 * section, from the same components — so committing from here behaves exactly as it
 * does there, including hooks, co-authors, amend and the commit options. The only
 * things that differ are the width, which is remembered separately, and the empty
 * state, which says nothing about tutorials or suggested next actions.
 */
export class BranchChanges extends React.Component<
  IBranchChangesProps,
  IBranchChangesState
> {
  public constructor(props: IBranchChangesProps) {
    super(props)
    this.state = { width: clampWidth(getNumber(storageKey, DefaultWidth)) }
  }

  public render() {
    return (
      <div className="hotflow-branch-changes">
        <Resizable
          id="hotflow-branch-changes-list"
          width={this.state.width}
          minimumWidth={MinWidth}
          maximumWidth={MaxWidth}
          onResize={this.onResize}
          onReset={this.onReset}
          description="Changed files"
        >
          <ChangesSidebarPane
            {...this.props.changesPaneProps}
            // -1 for the right-hand border, matching the repository view.
            availableWidth={this.state.width - 1}
            changesListScrollTop={this.state.scrollTop}
            onChangesListScrolled={this.onScrolled}
          />
        </Resizable>

        <div className="hotflow-branch-changes-diff">
          <ChangesDiffPane
            {...this.props.changesPaneProps}
            renderNoChanges={this.renderNoChanges}
          />
        </div>
      </div>
    )
  }

  /**
   * The clean working directory.
   *
   * Plainer than the repository view's, which offers to open an editor, preview a
   * pull request and so on. Someone who has HotFlow open is looking at a release,
   * and the actions for getting work into one are already on the row above.
   */
  private renderNoChanges = (): JSX.Element => {
    const { branchName } = this.props

    return (
      <div className="hotflow-empty-list hotflow-branch-changes-empty">
        <Octicon className="dim" symbol={octicons.check} />
        <span>
          {branchName === null
            ? 'No uncommitted changes.'
            : `No uncommitted changes on ${branchName}.`}
        </span>
      </div>
    )
  }

  private onResize = (width: number) => {
    this.setState({ width: clampWidth(width) })
  }

  private onReset = () => {
    this.setState({ width: DefaultWidth })
    setNumber(storageKey, DefaultWidth)
  }

  private onScrolled = (scrollTop: number) => {
    this.setState({ scrollTop })
  }

  public componentWillUnmount() {
    // Remembered on the way out rather than on every drag frame.
    setNumber(storageKey, this.state.width)
  }
}
