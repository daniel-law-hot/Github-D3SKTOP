/**
 * `IChangesPaneProps` is one bundle shared by the two components below, so each of
 * them genuinely uses only part of it and the rule fires on the remainder. Every
 * field is used by one or the other; splitting the interface in two would only move
 * the duplication out to the callers, which is the thing this file exists to avoid.
 */
/* eslint-disable react/no-unused-prop-types */

import * as React from 'react'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import {
  ChangesSelectionKind,
  CommitOptions,
  IConstrainedValue,
  IRepositoryState,
} from '../../lib/app-state'
import { ImageDiffType } from '../../models/diff'
import { StashedChangesLoadStates } from '../../models/stash-entry'
import { PopupType } from '../../models/popup'
import { TipState } from '../../models/tip'
import { Account } from '../../models/account'
import { Emoji } from '../../lib/emoji'
import { IssuesStore, GitHubUserStore } from '../../lib/stores'
import { openFile } from '../lib/open-file'
import { ChangesSidebar } from './sidebar'
import { Changes } from './changes'
import { MultipleSelection } from './multiple-selection'
import { StashDiffViewer } from '../stashing'

/**
 * The values the changes pane needs from application state.
 *
 * Both halves — the sidebar with its commit form, and the diff beside it — are
 * rendered in two places now: the repository view's Changes section and HotFlow's
 * Branch changes tab. This interface is what both callers fill in, so the wiring
 * exists once rather than being copied and left to drift.
 *
 * It is not extracted as a single component that renders both halves, because the
 * repository view can't use one: its sidebar `Resizable` is shared with the History
 * and Graph sections and holds the section tabs, so the sidebar and the content area
 * switch independently. Restructuring the app's central layout to suit a HotFlow tab
 * would be the tail wagging the dog. Two components, composed by each caller.
 */
export interface IChangesPaneProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly state: IRepositoryState

  readonly emoji: Map<string, Emoji>
  readonly accounts: ReadonlyArray<Account>
  readonly issuesStore: IssuesStore
  readonly gitHubUserStore: GitHubUserStore

  readonly imageDiffType: ImageDiffType
  readonly hideWhitespaceInChangesDiff: boolean
  readonly showSideBySideDiff: boolean
  readonly showDiffCheckMarks: boolean

  readonly focusCommitMessage: boolean
  readonly askForConfirmationOnDiscardChanges: boolean
  readonly askForConfirmationOnCommitFilteredChanges: boolean
  readonly askForConfirmationOnDiscardStash: boolean

  readonly externalEditorLabel?: string
  readonly onOpenInExternalEditor: (fullPath: string) => void

  readonly isShowingModal: boolean
  readonly isShowingFoldout: boolean

  readonly commitSpellcheckEnabled: boolean
  readonly showCommitLengthWarning: boolean
  readonly showChangesFilter: boolean
  readonly showChangesAsTree: boolean
  readonly changesTreeFilesFirst: boolean
  readonly shouldNudgeToCommit: boolean
  readonly shouldShowGenerateCommitMessageCallOut: boolean

  readonly stashedFilesWidth: IConstrainedValue

  readonly skipCommitHooks: boolean
  readonly signOffCommits: boolean
  readonly allowEmptyCommit: boolean

  readonly onUpdateCommitOptions: (
    repository: Repository,
    options: Partial<CommitOptions>
  ) => void
}

interface IChangesSidebarPaneProps extends IChangesPaneProps {
  /** Width the file list has to lay out in, minus any border. */
  readonly availableWidth: number

  /** Restores the list's scroll position when returning to it. */
  readonly changesListScrollTop?: number
  readonly onChangesListScrolled: (scrollTop: number) => void
}

/**
 * The file list, and the commit message form beneath it.
 *
 * A thin wrapper over `ChangesSidebar` that owns the derivations its callers were
 * each doing: the branch name from the tip, the most recent local commit, and the
 * commit progress popup.
 */
export class ChangesSidebarPane extends React.Component<IChangesSidebarPaneProps> {
  private readonly sidebarRef = React.createRef<ChangesSidebar>()

  /**
   * Moves focus into the file list.
   *
   * Forwarded rather than inherited: callers used to hold a ref straight to
   * `ChangesSidebar` and call this on it, and wrapping it would otherwise have
   * quietly broken the keyboard shortcut that focuses the changes list.
   */
  public focus() {
    this.sidebarRef.current?.focus()
  }

  public render() {
    const { state } = this.props
    const { tip } = state.branchesState

    const branchName =
      tip.kind === TipState.Valid
        ? tip.branch.name
        : tip.kind === TipState.Unborn
        ? tip.ref
        : null

    const mostRecentLocalCommitSHA =
      state.localCommitSHAs.length > 0 ? state.localCommitSHAs[0] : null

    const mostRecentLocalCommit =
      (mostRecentLocalCommitSHA
        ? state.commitLookup.get(mostRecentLocalCommitSHA)
        : null) || null

    return (
      <ChangesSidebar
        ref={this.sidebarRef}
        repository={this.props.repository}
        dispatcher={this.props.dispatcher}
        changes={state.changesState}
        aheadBehind={state.aheadBehind}
        branch={branchName}
        commitAuthor={state.commitAuthor}
        emoji={this.props.emoji}
        mostRecentLocalCommit={mostRecentLocalCommit}
        issuesStore={this.props.issuesStore}
        availableWidth={this.props.availableWidth}
        gitHubUserStore={this.props.gitHubUserStore}
        isCommitting={state.isCommitting}
        hookProgress={state.hookProgress}
        onShowCommitProgress={
          state.subscribeToCommitOutput ? this.onShowCommitProgress : undefined
        }
        isGeneratingCommitMessage={state.isGeneratingCommitMessage}
        shouldShowGenerateCommitMessageCallOut={
          this.props.shouldShowGenerateCommitMessageCallOut
        }
        commitToAmend={state.commitToAmend}
        isPushPullFetchInProgress={state.isPushPullFetchInProgress}
        focusCommitMessage={this.props.focusCommitMessage}
        askForConfirmationOnDiscardChanges={
          this.props.askForConfirmationOnDiscardChanges
        }
        askForConfirmationOnCommitFilteredChanges={
          this.props.askForConfirmationOnCommitFilteredChanges
        }
        accounts={this.props.accounts}
        isShowingModal={this.props.isShowingModal}
        isShowingFoldout={this.props.isShowingFoldout}
        externalEditorLabel={this.props.externalEditorLabel}
        onOpenInExternalEditor={this.props.onOpenInExternalEditor}
        onChangesListScrolled={this.props.onChangesListScrolled}
        changesListScrollTop={this.props.changesListScrollTop}
        shouldNudgeToCommit={this.props.shouldNudgeToCommit}
        commitSpellcheckEnabled={this.props.commitSpellcheckEnabled}
        showCommitLengthWarning={this.props.showCommitLengthWarning}
        showChangesFilter={this.props.showChangesFilter}
        showChangesAsTree={this.props.showChangesAsTree}
        changesTreeFilesFirst={this.props.changesTreeFilesFirst}
        skipCommitHooks={this.props.skipCommitHooks}
        signOffCommits={this.props.signOffCommits}
        allowEmptyCommit={this.props.allowEmptyCommit}
        onUpdateCommitOptions={this.props.onUpdateCommitOptions}
      />
    )
  }

  private onShowCommitProgress = () => {
    const { subscribeToCommitOutput } = this.props.state

    if (!subscribeToCommitOutput) {
      return
    }

    this.props.dispatcher.showPopup({
      type: PopupType.CommitProgress,
      subscribeToCommitOutput,
    })
  }
}

interface IChangesDiffPaneProps extends IChangesPaneProps {
  /**
   * What to show when the working directory is clean.
   *
   * The repository view has a whole onboarding surface for this — suggested next
   * actions, the tutorial — that has no business in a HotFlow tab, so each caller
   * supplies its own.
   */
  readonly renderNoChanges: () => JSX.Element | null
}

/**
 * The diff beside the file list: one file's changes, a count when several are
 * selected, or a stash.
 */
export class ChangesDiffPane extends React.Component<IChangesDiffPaneProps> {
  public render() {
    const { changesState } = this.props.state
    const { workingDirectory, selection } = changesState

    if (selection.kind === ChangesSelectionKind.Stash) {
      return this.renderStashedChanges()
    }

    const { selectedFileIDs, diff } = selection

    if (selectedFileIDs.length > 1) {
      return <MultipleSelection count={selectedFileIDs.length} />
    }

    if (workingDirectory.files.length === 0) {
      return this.props.renderNoChanges()
    }

    if (selectedFileIDs.length === 0) {
      return null
    }

    const selectedFile = workingDirectory.findFileWithID(selectedFileIDs[0])

    if (selectedFile === null) {
      return null
    }

    return (
      <Changes
        repository={this.props.repository}
        dispatcher={this.props.dispatcher}
        file={selectedFile}
        diff={diff}
        isCommitting={this.props.state.isCommitting}
        imageDiffType={this.props.imageDiffType}
        hideWhitespaceInDiff={this.props.hideWhitespaceInChangesDiff}
        showSideBySideDiff={this.props.showSideBySideDiff}
        showDiffCheckMarks={this.props.showDiffCheckMarks}
        onOpenBinaryFile={this.onOpenBinaryFile}
        onOpenSubmodule={this.onOpenSubmodule}
        onChangeImageDiffType={this.onChangeImageDiffType}
        askForConfirmationOnDiscardChanges={
          this.props.askForConfirmationOnDiscardChanges
        }
        onDiffOptionsOpened={this.onDiffOptionsOpened}
      />
    )
  }

  private renderStashedChanges(): JSX.Element | null {
    const { selection, stashEntry } = this.props.state.changesState

    if (selection.kind !== ChangesSelectionKind.Stash || stashEntry === null) {
      return null
    }

    if (stashEntry.files.kind !== StashedChangesLoadStates.Loaded) {
      return null
    }

    return (
      <StashDiffViewer
        stashEntry={stashEntry}
        selectedStashedFile={selection.selectedStashedFile}
        stashedFileDiff={selection.selectedStashedFileDiff}
        imageDiffType={this.props.imageDiffType}
        fileListWidth={this.props.stashedFilesWidth}
        repository={this.props.repository}
        dispatcher={this.props.dispatcher}
        askForConfirmationOnDiscardStash={
          this.props.askForConfirmationOnDiscardStash
        }
        showSideBySideDiff={this.props.showSideBySideDiff}
        onOpenBinaryFile={this.onOpenBinaryFile}
        onOpenSubmodule={this.onOpenSubmodule}
        onChangeImageDiffType={this.onChangeImageDiffType}
        onHideWhitespaceInDiffChanged={this.onHideWhitespaceInDiffChanged}
        onOpenInExternalEditor={this.props.onOpenInExternalEditor}
      />
    )
  }

  private onOpenBinaryFile = (fullPath: string) => {
    openFile(fullPath, this.props.dispatcher)
  }

  private onOpenSubmodule = (fullPath: string) => {
    this.props.dispatcher.incrementMetric('openSubmoduleFromDiffCount')
    this.props.dispatcher.openOrAddRepository(fullPath)
  }

  private onChangeImageDiffType = (imageDiffType: ImageDiffType) => {
    this.props.dispatcher.changeImageDiffType(imageDiffType)
  }

  private onDiffOptionsOpened = () => {
    this.props.dispatcher.incrementMetric('diffOptionsViewedCount')
  }

  private onHideWhitespaceInDiffChanged = (hideWhitespaceInDiff: boolean) => {
    return this.props.dispatcher.onHideWhitespaceInChangesDiffChanged(
      hideWhitespaceInDiff,
      this.props.repository
    )
  }
}
