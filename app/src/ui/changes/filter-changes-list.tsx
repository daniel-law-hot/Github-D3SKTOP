import * as React from 'react'
import * as Path from 'path'

import { Dispatcher } from '../dispatcher'
import { IMenuItem } from '../../lib/menu-item'
import { revealInFileManager } from '../../lib/app-shell'
import { encodePathAsUrl } from '../../lib/path'
import {
  WorkingDirectoryStatus,
  WorkingDirectoryFileChange,
  AppFileStatusKind,
} from '../../models/status'
import { DiffSelectionType } from '../../models/diff'
import { CommitIdentity } from '../../models/commit-identity'
import { ICommitMessage } from '../../models/commit-message'
import {
  isRepositoryWithGitHubRepository,
  Repository,
} from '../../models/repository'
import { Account } from '../../models/account'
import { Author, UnknownAuthor } from '../../models/author'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { CommitOptions, IFileListFilterState } from '../../lib/app-state'
import {
  isSafeFileExtension,
  DefaultEditorLabel,
  CopyFilePathLabel,
  RevealInFileManagerLabel,
  OpenWithDefaultProgramLabel,
  CopyRelativeFilePathLabel,
  CopySelectedPathsLabel,
  CopySelectedRelativePathsLabel,
} from '../lib/context-menu'
import { CommitMessage } from './commit-message'
import { ChangedFile } from './changed-file'
import { ChangedFolder } from './changed-folder'
import {
  buildChangesTree,
  compactChangesTree,
  flattenChangesTree,
  ChangesTreeNode,
} from './changes-tree'
import { IAutocompletionProvider } from '../autocompletion'
import { showContextualMenu } from '../../lib/menu-item'
import { arrayEquals } from '../../lib/equality'
import { clipboard } from 'electron'
import { basename } from 'path'
import { Commit, ICommitContext } from '../../models/commit'
import {
  RebaseConflictState,
  ConflictState,
  Foldout,
} from '../../lib/app-state'
import { ContinueRebase } from './continue-rebase'
import { Octicon, OcticonSymbolVariant } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { IStashEntry } from '../../models/stash-entry'
import classNames from 'classnames'
import { hasWritePermission } from '../../models/github-repository'
import { hasConflictedFiles } from '../../lib/status'
import { createObservableRef } from '../lib/observable-ref'
import { Popup, PopupType } from '../../models/popup'
import { EOL } from 'os'
import { RepoRulesInfo } from '../../models/repo-rules'
import { IAheadBehind } from '../../models/branch'
import { StashDiffViewerId } from '../stashing'
import { AugmentedSectionFilterList } from '../lib/augmented-filter-list'
import { IFilterListGroup, IFilterListItem } from '../lib/filter-list'
import { ClickSource } from '../lib/list'
import memoizeOne from 'memoize-one'
import { IMatches } from '../../lib/fuzzy-find'
import { TextBox } from '../lib/text-box'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { plural } from '../lib/plural'
import {
  isCommittingFileHiddenByFilter,
  getNoResultsMessage,
  hasActiveFilters,
  applyFilters,
  fileMatchesFilterOptions,
} from './filter-changes-logic'
import { ChangesListFilterOptions } from './changes-list-filter-options'
import { HookProgress } from '../../lib/git'
import { formatNumber } from '../../lib/format-number'

export interface IChangesListItem extends IFilterListItem {
  readonly id: string
  readonly text: ReadonlyArray<string>
  /**
   * The associated file change. Present for file rows; `undefined` for folder
   * rows in the tree view.
   */
  readonly change?: WorkingDirectoryFileChange
  /**
   * The tree node this row represents, when the list is rendered as a folder
   * tree. `undefined` in the flat list view.
   */
  readonly treeNode?: ChangesTreeNode
}

/**
 * The indentation, in pixels, applied per level of tree nesting. Equal to one
 * column/cell width so child rows align under their parent's expander. Keep in
 * sync with `--tree-cell-width` in _file-list.scss.
 */
const TreeIndentPerLevel = 20

const RowHeight = 29
const StashIcon: OcticonSymbolVariant = {
  w: 16,
  h: 16,
  p: [
    'M10.5 1.286h-9a.214.214 0 0 0-.214.214v9a.214.214 0 0 0 .214.214h9a.214.214 0 0 0 ' +
      '.214-.214v-9a.214.214 0 0 0-.214-.214zM1.5 0h9A1.5 1.5 0 0 1 12 1.5v9a1.5 1.5 0 0 1-1.5 ' +
      '1.5h-9A1.5 1.5 0 0 1 0 10.5v-9A1.5 1.5 0 0 1 1.5 0zm5.712 7.212a1.714 1.714 0 1 ' +
      '1-2.424-2.424 1.714 1.714 0 0 1 2.424 2.424zM2.015 12.71c.102.729.728 1.29 1.485 ' +
      '1.29h9a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.29-1.485v1.442a.216.216 0 0 1 ' +
      '.004.043v9a.214.214 0 0 1-.214.214h-9a.216.216 0 0 1-.043-.004H2.015zm2 2c.102.729.728 ' +
      '1.29 1.485 1.29h9a1.5 1.5 0 0 0 1.5-1.5v-9a1.5 1.5 0 0 0-1.29-1.485v1.442a.216.216 0 0 1 ' +
      '.004.043v9a.214.214 0 0 1-.214.214h-9a.216.216 0 0 1-.043-.004H4.015z',
  ],
}

const GitIgnoreFileName = '.gitignore'

interface IFilterChangesListProps {
  readonly repository: Repository
  readonly repositoryAccount: Account | null
  readonly workingDirectory: WorkingDirectoryStatus
  readonly mostRecentLocalCommit: Commit | null
  /**
   * An object containing the conflicts in the working directory.
   * When null it means that there are no conflicts.
   */
  readonly conflictState: ConflictState | null
  readonly rebaseConflictState: RebaseConflictState | null
  readonly selectedFileIDs: ReadonlyArray<string>
  readonly onFileSelectionChanged: (rows: ReadonlyArray<number>) => void
  readonly onIncludeChanged: (
    file:
      | WorkingDirectoryFileChange
      | ReadonlyArray<WorkingDirectoryFileChange>,
    include: boolean
  ) => void
  readonly onCreateCommit: (context: ICommitContext) => Promise<boolean>
  readonly onDiscardChanges: (file: WorkingDirectoryFileChange) => void
  readonly askForConfirmationOnDiscardChanges: boolean
  readonly askForConfirmationOnCommitFilteredChanges: boolean
  readonly focusCommitMessage: boolean
  readonly isShowingModal: boolean
  readonly isShowingFoldout: boolean
  readonly onDiscardChangesFromFiles: (
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    isDiscardingAllChanges: boolean
  ) => void

  /** Callback that fires on page scroll to pass the new scrollTop location */
  readonly onChangesListScrolled: (scrollTop: number) => void

  /* The scrollTop of the compareList. It is stored to allow for scroll position persistence */
  readonly changesListScrollTop?: number

  /**
   * Called to open a file in its default application
   *
   * @param path The path of the file relative to the root of the repository
   */
  readonly onOpenItem: (path: string) => void

  /**
   * Called to open a file in the default external editor
   *
   * @param path The path of the file relative to the root of the repository
   */
  readonly onOpenItemInExternalEditor: (path: string) => void

  /**
   * The currently checked out branch (null if no branch is checked out).
   */
  readonly branch: string | null
  readonly commitAuthor: CommitIdentity | null
  readonly dispatcher: Dispatcher
  readonly availableWidth: number
  readonly isCommitting: boolean
  readonly hookProgress: HookProgress | null
  readonly onShowCommitProgress?: (() => void) | undefined
  readonly isGeneratingCommitMessage: boolean
  readonly shouldShowGenerateCommitMessageCallOut: boolean
  readonly commitToAmend: Commit | null
  readonly currentBranchProtected: boolean
  readonly currentRepoRulesInfo: RepoRulesInfo
  readonly aheadBehind: IAheadBehind | null

  /**
   * Click event handler passed directly to the onRowClick prop of List, see
   * List Props for documentation.
   */
  readonly onRowClick?: (row: number, source: ClickSource) => void
  readonly commitMessage: ICommitMessage

  /** The autocompletion providers available to the repository. */
  readonly autocompletionProviders: ReadonlyArray<IAutocompletionProvider<any>>

  /** Called when the given file should be ignored. */
  readonly onIgnoreFile: (pattern: string | string[]) => void

  /** Called when the given pattern should be ignored. */
  readonly onIgnorePattern: (pattern: string | string[]) => void

  /**
   * Whether or not to show a field for adding co-authors to
   * a commit (currently only supported for GH/GHE repositories)
   */
  readonly showCoAuthoredBy: boolean

  /**
   * A list of authors (name, email pairs) which have been
   * entered into the co-authors input box in the commit form
   * and which _may_ be used in the subsequent commit to add
   * Co-Authored-By commit message trailers depending on whether
   * the user has chosen to do so.
   */
  readonly coAuthors: ReadonlyArray<Author>

  /** The name of the currently selected external editor */
  readonly externalEditorLabel?: string

  readonly stashEntry: IStashEntry | null

  readonly isShowingStashEntry: boolean

  /**
   * Whether we should show the onboarding tutorial nudge
   * arrow pointing at the commit summary box
   */
  readonly shouldNudgeToCommit: boolean

  readonly commitSpellcheckEnabled: boolean

  readonly showCommitLengthWarning: boolean

  readonly accounts: ReadonlyArray<Account>

  /** The file list filter state containing all filter options */
  readonly fileListFilter: IFileListFilterState

  /** Whether or not to show the changes filter */
  readonly showChangesFilter: boolean

  /**
   * Whether to show the row above the list carrying the changed-file count, the
   * select-all checkbox and the list/tree and sort toggles.
   *
   * Off in HotFlow's Branch changes tab, which shows the files and nothing else.
   * Note this takes the select-all checkbox with it, so anywhere it's off should
   * either not need select-all or offer it elsewhere.
   */
  readonly showChangesListHeader: boolean

  /** Whether the commit form shows the author avatar beside the summary */
  readonly showCommitAvatar: boolean

  /** Whether the commit form shows the action bar under the description */
  readonly showCommitActionBar: boolean

  /** Whether to show the changed files as a folder tree instead of a flat list */
  readonly showChangesAsTree: boolean

  /** Whether a folder's own files are listed before its subfolders in tree view */
  readonly changesTreeFilesFirst: boolean

  /**
   * Whether or not to skip blocking commit hooks when creating commits
   * by means of passing the `--no-verify` flag to git commit
   */
  readonly skipCommitHooks: boolean

  /**
   * Whether or not to add a `Signed-off-by` trailer to commit messages
   * by means of passing the `--signoff` flag to git commit
   */
  readonly signOffCommits: boolean

  /**
   * Whether or not to allow creating a commit without any file changes
   * by means of passing the `--allow-empty` flag to git commit.
   * This option resets to false after each commit.
   */
  readonly allowEmptyCommit: boolean

  /** Callback to set commit options for the given repository */
  readonly onUpdateCommitOptions: (
    repository: Repository,
    options: Partial<CommitOptions>
  ) => void
}

interface IFilterChangesListState {
  readonly filteredItems: Map<string, IChangesListItem>
  readonly selectedItems: ReadonlyArray<IChangesListItem>
  readonly focusedRow: string | null
  readonly groups: ReadonlyArray<IFilterListGroup<IChangesListItem>>
  /** The set of folder paths that are currently collapsed in the tree view. */
  readonly collapsedFolders: ReadonlySet<string>
}

function getSelectedItemsFromProps(
  props: IFilterChangesListProps
): ReadonlyArray<IChangesListItem> {
  if (props.selectedFileIDs.length === 0) {
    return []
  }

  const selectedItems = []
  for (let i = 0; i < props.selectedFileIDs.length; i++) {
    const fid = props.selectedFileIDs[i]
    const file = props.workingDirectory.findFileWithID(fid)
    if (file === null) {
      continue
    }

    selectedItems.push({
      text: [file.path, file.status.kind.toString()],
      id: file.id,
      change: file,
    })
  }

  return selectedItems
}

/** Get checkbox value from includeAll status */
function getCheckBoxValueFromIncludeAll(
  includeAll: boolean | null
): CheckboxValue {
  if (includeAll === true) {
    return CheckboxValue.On
  }

  if (includeAll === false) {
    return CheckboxValue.Off
  }

  return CheckboxValue.Mixed
}

export class FilterChangesList extends React.Component<
  IFilterChangesListProps,
  IFilterChangesListState
> {
  private filterTextBox: TextBox | undefined = undefined
  private headerRef = createObservableRef<HTMLDivElement>()
  private filterOptionsButtonRef: HTMLButtonElement | null = null
  private includeAllCheckBoxRef = React.createRef<Checkbox>()
  private filterListRef =
    React.createRef<AugmentedSectionFilterList<IChangesListItem>>()

  /** Compute the 'Include All' checkbox value */
  private getCheckAllValue = memoizeOne(
    (
      workingDirectory: WorkingDirectoryStatus,
      rebaseConflictState: RebaseConflictState | null,
      filteredItems: Map<string, IChangesListItem>
    ): CheckboxValue => {
      if (
        filteredItems.size === workingDirectory.files.length &&
        rebaseConflictState === null
      ) {
        return getCheckBoxValueFromIncludeAll(workingDirectory.includeAll)
      }

      const files = workingDirectory.files.filter(f => filteredItems.has(f.id))

      if (files.length === 0) {
        // the current commit will be skipped in the rebase
        return CheckboxValue.Off
      }

      if (rebaseConflictState !== null) {
        // untracked files will be skipped by the rebase, so we need to ensure that
        // the "Include All" checkbox matches this state
        const onlyUntrackedFilesFound = files.every(
          f => f.status.kind === AppFileStatusKind.Untracked
        )

        if (onlyUntrackedFilesFound) {
          return CheckboxValue.Off
        }

        const onlyTrackedFilesFound = files.every(
          f => f.status.kind !== AppFileStatusKind.Untracked
        )

        // show "Mixed" if we have a mixture of tracked and untracked changes
        return onlyTrackedFilesFound ? CheckboxValue.On : CheckboxValue.Mixed
      }

      const filteredStatus = WorkingDirectoryStatus.fromFiles(files)

      return getCheckBoxValueFromIncludeAll(filteredStatus.includeAll)
    }
  )

  public constructor(props: IFilterChangesListProps) {
    super(props)

    const collapsedFolders = new Set<string>()
    const { group, filteredItems } = this.buildItems(props, collapsedFolders)

    this.state = {
      filteredItems,
      selectedItems: getSelectedItemsFromProps(props),
      focusedRow: null,
      groups: [group],
      collapsedFolders,
    }
  }

  public componentWillReceiveProps(nextProps: IFilterChangesListProps) {
    const filesChanged = !arrayEquals(
      nextProps.workingDirectory.files,
      this.props.workingDirectory.files
    )
    const selectionChanged = !arrayEquals(
      nextProps.selectedFileIDs,
      this.props.selectedFileIDs
    )
    const viewModeChanged =
      nextProps.showChangesAsTree !== this.props.showChangesAsTree

    // In the tree view we build (and filter) the items ourselves, so we also
    // need to rebuild when the filter state changes. In the flat list view the
    // filtering is performed by the list component itself.
    const filterChanged =
      nextProps.showChangesAsTree &&
      (nextProps.fileListFilter !== this.props.fileListFilter ||
        nextProps.showChangesFilter !== this.props.showChangesFilter)

    const sortOrderChanged =
      nextProps.showChangesAsTree &&
      nextProps.changesTreeFilesFirst !== this.props.changesTreeFilesFirst

    if (
      filesChanged ||
      selectionChanged ||
      viewModeChanged ||
      filterChanged ||
      sortOrderChanged
    ) {
      // Reset the collapsed state when toggling between views so the tree
      // always starts fully expanded.
      const collapsedFolders = viewModeChanged
        ? new Set<string>()
        : this.state.collapsedFolders

      const { group, filteredItems } = this.buildItems(
        nextProps,
        collapsedFolders
      )

      // In the flat list view `filteredItems` is owned by the list's filter
      // callback, so we only overwrite it when building the tree (or when
      // switching views, to seed a sensible initial value).
      const shouldSetFilteredItems =
        nextProps.showChangesAsTree || viewModeChanged

      const baseState = {
        selectedItems: getSelectedItemsFromProps(nextProps),
        groups: [group],
        collapsedFolders,
      }

      if (shouldSetFilteredItems) {
        this.setState({ ...baseState, filteredItems })
      } else {
        this.setState(baseState)
      }
    }
  }

  /**
   * Build the list group and the map of filter-matching file items for the
   * current view mode (flat list or folder tree).
   */
  private buildItems(
    props: IFilterChangesListProps,
    collapsedFolders: ReadonlySet<string>
  ): {
    group: IFilterListGroup<IChangesListItem>
    filteredItems: Map<string, IChangesListItem>
  } {
    if (props.showChangesAsTree) {
      const files = this.getTreeFilteredFiles(props)
      const nodes = flattenChangesTree(
        compactChangesTree(buildChangesTree(files)),
        collapsedFolders,
        props.changesTreeFilesFirst
      )

      const items: ReadonlyArray<IChangesListItem> = nodes.map(node =>
        node.kind === 'folder'
          ? { id: node.path, text: [node.path], treeNode: node }
          : {
              id: node.change.id,
              text: [node.change.path],
              change: node.change,
              treeNode: node,
            }
      )

      const filteredItems = new Map<string, IChangesListItem>(
        files.map(f => [f.id, { id: f.id, text: [f.path], change: f }])
      )

      return { group: { identifier: 'changed-files', items }, filteredItems }
    }

    const items = props.workingDirectory.files.map(file => ({
      text: [file.path],
      id: file.id,
      change: file,
    }))

    return {
      group: { identifier: 'changed-files', items },
      filteredItems: new Map<string, IChangesListItem>(
        items.map(i => [i.id, i])
      ),
    }
  }

  /**
   * Apply the active text and option filters to the working directory files.
   * Used to build the folder tree from the filtered set so that empty folders
   * are pruned. Mirrors the filtering the list component performs in flat view.
   */
  private getTreeFilteredFiles(
    props: IFilterChangesListProps
  ): ReadonlyArray<WorkingDirectoryFileChange> {
    const files = props.workingDirectory.files

    if (!props.showChangesFilter) {
      return files
    }

    const { filterText } = props.fileListFilter
    const search = filterText.toLowerCase()

    return files.filter(
      f =>
        (search === '' || f.path.toLowerCase().includes(search)) &&
        fileMatchesFilterOptions(f, props.fileListFilter)
    )
  }

  private toggleFolderExpanded = (path: string) => {
    const collapsedFolders = new Set(this.state.collapsedFolders)
    if (collapsedFolders.has(path)) {
      collapsedFolders.delete(path)
    } else {
      collapsedFolders.add(path)
    }

    const { group } = this.buildItems(this.props, collapsedFolders)
    this.setState({ collapsedFolders, groups: [group] })
  }

  private setFolderExpanded = (path: string, expanded: boolean) => {
    const isCollapsed = this.state.collapsedFolders.has(path)
    if (expanded === !isCollapsed) {
      return
    }
    this.toggleFolderExpanded(path)
  }

  private toggleFolderInclude = (node: ChangesTreeNode) => {
    if (node.kind !== 'folder') {
      return
    }

    const allIncluded = node.files.every(
      f => f.selection.getSelectionType() === DiffSelectionType.All
    )

    this.props.onIncludeChanged(node.files, !allIncluded)
  }

  private onFolderIncludeChanged = (path: string, include: boolean) => {
    const item = this.state.groups[0]?.items.find(i => i.id === path)
    if (item?.treeNode?.kind === 'folder') {
      this.props.onIncludeChanged(item.treeNode.files, include)
    }
  }

  private onIncludeAllChanged = (event: React.FormEvent<HTMLInputElement>) => {
    const include = event.currentTarget.checked
    const filteredItemPaths = Array.from(this.state.filteredItems, ([, v]) => v)
      .map(v => v.change)
      .filter((c): c is WorkingDirectoryFileChange => c !== undefined)
    this.props.onIncludeChanged(filteredItemPaths, include)
  }

  private renderChangedFile = (
    changeListItem: IChangesListItem,
    matches: IMatches
  ): JSX.Element | null => {
    const {
      rebaseConflictState,
      isCommitting,
      onIncludeChanged,
      availableWidth,
    } = this.props

    const node = changeListItem.treeNode

    if (node?.kind === 'folder') {
      return this.renderChangedFolder(node)
    }

    const file = changeListItem.change

    if (file === undefined) {
      return null
    }

    const indentation = node ? node.depth * TreeIndentPerLevel : 0
    const selection = file.selection.getSelectionType()
    const { submoduleStatus } = file.status

    const isUncommittableSubmodule =
      submoduleStatus !== undefined &&
      file.status.kind === AppFileStatusKind.Modified &&
      !submoduleStatus.commitChanged

    const isPartiallyCommittableSubmodule =
      submoduleStatus !== undefined &&
      (submoduleStatus.commitChanged ||
        file.status.kind === AppFileStatusKind.New) &&
      (submoduleStatus.modifiedChanges || submoduleStatus.untrackedChanges)

    const includeAll =
      selection === DiffSelectionType.All
        ? true
        : selection === DiffSelectionType.None
        ? false
        : null

    const include = isUncommittableSubmodule
      ? false
      : rebaseConflictState !== null
      ? file.status.kind !== AppFileStatusKind.Untracked
      : includeAll

    const disableSelection =
      isCommitting || rebaseConflictState !== null || isUncommittableSubmodule

    const checkboxTooltip = isUncommittableSubmodule
      ? 'This submodule change cannot be added to a commit in this repository because it contains changes that have not been committed.'
      : isPartiallyCommittableSubmodule
      ? 'Only changes that have been committed within the submodule will be added to this repository. You need to commit any other modified or untracked changes in the submodule before including them in this repository.'
      : undefined

    return (
      <ChangedFile
        file={file}
        include={isPartiallyCommittableSubmodule && include ? null : include}
        key={file.id}
        onIncludeChanged={onIncludeChanged}
        availableWidth={availableWidth}
        indentation={indentation}
        pathAsBaseName={this.props.showChangesAsTree}
        disableSelection={disableSelection}
        checkboxTooltip={checkboxTooltip}
        focused={this.state.focusedRow === changeListItem.id}
        matches={matches}
      />
    )
  }

  private renderChangedFolder = (node: ChangesTreeNode): JSX.Element | null => {
    if (node.kind !== 'folder') {
      return null
    }

    const { rebaseConflictState, isCommitting } = this.props

    const allIncluded = node.files.every(
      f => f.selection.getSelectionType() === DiffSelectionType.All
    )
    const noneIncluded = node.files.every(
      f => f.selection.getSelectionType() === DiffSelectionType.None
    )
    const include = allIncluded ? true : noneIncluded ? false : null

    const disableSelection = isCommitting || rebaseConflictState !== null

    return (
      <ChangedFolder
        path={node.path}
        name={node.name}
        key={node.path}
        indentation={node.depth * TreeIndentPerLevel}
        expanded={!this.state.collapsedFolders.has(node.path)}
        include={include}
        disableSelection={disableSelection}
        onIncludeChanged={this.onFolderIncludeChanged}
      />
    )
  }

  private onDiscardAllChanges = () => {
    this.props.onDiscardChangesFromFiles(
      this.props.workingDirectory.files,
      true
    )
  }

  private onStashChanges = () => {
    this.props.dispatcher.createStashForCurrentBranch(this.props.repository)
  }

  private onDiscardChanges = (files: ReadonlyArray<string>) => {
    const workingDirectory = this.props.workingDirectory

    if (files.length === 1) {
      const modifiedFile = workingDirectory.files.find(f => f.path === files[0])

      if (modifiedFile != null) {
        this.props.onDiscardChanges(modifiedFile)
      }
    } else {
      const modifiedFiles = new Array<WorkingDirectoryFileChange>()

      files.forEach(file => {
        const modifiedFile = workingDirectory.files.find(f => f.path === file)

        if (modifiedFile != null) {
          modifiedFiles.push(modifiedFile)
        }
      })

      if (modifiedFiles.length > 0) {
        // DiscardAllChanges can also be used for discarding several selected changes.
        // Therefore, we update the pop up to reflect whether or not it is "all" changes.
        const discardingAllChanges =
          modifiedFiles.length === workingDirectory.files.length

        this.props.onDiscardChangesFromFiles(
          modifiedFiles,
          discardingAllChanges
        )
      }
    }
  }

  private getDiscardChangesMenuItemLabel = (files: ReadonlyArray<string>) => {
    const label =
      files.length === 1
        ? __DARWIN__
          ? `Discard Changes`
          : `Discard changes`
        : __DARWIN__
        ? `Discard ${files.length} Selected Changes`
        : `Discard ${files.length} selected changes`

    return this.props.askForConfirmationOnDiscardChanges ? `${label}…` : label
  }

  private onContextMenu = (event: React.MouseEvent<any>) => {
    event.preventDefault()

    // need to preserve the working directory state while dealing with conflicts
    if (this.props.rebaseConflictState !== null || this.props.isCommitting) {
      return
    }

    const hasLocalChanges = this.props.workingDirectory.files.length > 0
    const hasStash = this.props.stashEntry !== null
    const hasConflicts =
      this.props.conflictState !== null ||
      hasConflictedFiles(this.props.workingDirectory)

    const stashAllChangesLabel = __DARWIN__
      ? 'Stash All Changes'
      : 'Stash all changes'
    const confirmStashAllChangesLabel = __DARWIN__
      ? 'Stash All Changes…'
      : 'Stash all changes…'

    const items: IMenuItem[] = [
      {
        label: __DARWIN__ ? 'Discard All Changes…' : 'Discard all changes…',
        action: this.onDiscardAllChanges,
        enabled: hasLocalChanges,
      },
      {
        label: hasStash ? confirmStashAllChangesLabel : stashAllChangesLabel,
        action: this.onStashChanges,
        enabled: hasLocalChanges && this.props.branch !== null && !hasConflicts,
      },
    ]

    showContextualMenu(items)
  }

  private getDiscardChangesMenuItem = (
    paths: ReadonlyArray<string>
  ): IMenuItem => {
    return {
      label: this.getDiscardChangesMenuItemLabel(paths),
      action: () => this.onDiscardChanges(paths),
    }
  }

  private getCopyPathMenuItem = (
    file: WorkingDirectoryFileChange
  ): IMenuItem => {
    return {
      label: CopyFilePathLabel,
      action: () => {
        const fullPath = Path.join(this.props.repository.path, file.path)
        clipboard.writeText(fullPath)
      },
    }
  }

  private getCopyRelativePathMenuItem = (
    file: WorkingDirectoryFileChange
  ): IMenuItem => {
    return {
      label: CopyRelativeFilePathLabel,
      action: () => clipboard.writeText(Path.normalize(file.path)),
    }
  }

  private getCopySelectedPathsMenuItem = (
    files: WorkingDirectoryFileChange[]
  ): IMenuItem => {
    return {
      label: CopySelectedPathsLabel,
      action: () => {
        const fullPaths = files.map(file =>
          Path.join(this.props.repository.path, file.path)
        )
        clipboard.writeText(fullPaths.join(EOL))
      },
    }
  }

  private getCopySelectedRelativePathsMenuItem = (
    files: WorkingDirectoryFileChange[]
  ): IMenuItem => {
    return {
      label: CopySelectedRelativePathsLabel,
      action: () => {
        const paths = files.map(file => Path.normalize(file.path))
        clipboard.writeText(paths.join(EOL))
      },
    }
  }

  private getRevealInFileManagerMenuItem = (
    file: WorkingDirectoryFileChange
  ): IMenuItem => {
    return {
      label: RevealInFileManagerLabel,
      action: () => revealInFileManager(this.props.repository, file.path),
      enabled: file.status.kind !== AppFileStatusKind.Deleted,
    }
  }

  private getOpenInExternalEditorMenuItem = (
    file: WorkingDirectoryFileChange,
    enabled: boolean
  ): IMenuItem => {
    const { externalEditorLabel } = this.props

    const openInExternalEditor = externalEditorLabel
      ? `Open in ${externalEditorLabel}`
      : DefaultEditorLabel

    return {
      label: openInExternalEditor,
      action: () => {
        this.props.onOpenItemInExternalEditor(file.path)
      },
      enabled,
    }
  }

  private getDefaultContextMenu(
    file: WorkingDirectoryFileChange
  ): ReadonlyArray<IMenuItem> {
    const { id, path, status } = file

    const extension = Path.extname(path)
    const isSafeExtension = isSafeFileExtension(extension)

    const { workingDirectory, selectedFileIDs } = this.props

    const selectedFiles = new Array<WorkingDirectoryFileChange>()
    const paths = new Array<string>()
    const extensions = new Set<string>()

    const addItemToArray = (fileID: string) => {
      const newFile = workingDirectory.findFileWithID(fileID)
      if (newFile) {
        selectedFiles.push(newFile)
        paths.push(newFile.path)

        const extension = Path.extname(newFile.path)
        if (extension.length) {
          extensions.add(extension)
        }
      }
    }

    if (selectedFileIDs.includes(id)) {
      // user has selected a file inside an existing selection
      // -> context menu entries should be applied to all selected files
      selectedFileIDs.forEach(addItemToArray)
    } else {
      // this is outside their previous selection
      // -> context menu entries should be applied to just this file
      addItemToArray(id)
    }

    const items: IMenuItem[] = [
      this.getDiscardChangesMenuItem(paths),
      { type: 'separator' },
    ]
    if (paths.length === 1) {
      const enabled = Path.basename(path) !== GitIgnoreFileName
      items.push({
        label: __DARWIN__
          ? 'Ignore File (Add to .gitignore)'
          : 'Ignore file (add to .gitignore)',
        action: () => this.props.onIgnoreFile(path),
        enabled,
      })

      // Even on Windows, the path separator is '/' for git operations so cannot
      // use Path.sep
      const pathComponents = path.split('/').slice(0, -1)
      if (pathComponents.length > 0) {
        const submenu = pathComponents.map((_, index) => {
          const label = `/${pathComponents
            .slice(0, pathComponents.length - index)
            .join('/')}`
          return {
            label,
            action: () => this.props.onIgnoreFile(label),
          }
        })

        items.push({
          label: __DARWIN__
            ? 'Ignore Folder (Add to .gitignore)'
            : 'Ignore folder (add to .gitignore)',
          submenu,
          enabled,
        })
      }
    } else if (paths.length > 1) {
      items.push({
        label: __DARWIN__
          ? `Ignore ${paths.length} Selected Files (Add to .gitignore)`
          : `Ignore ${paths.length} selected files (add to .gitignore)`,
        action: () => {
          // Filter out any .gitignores that happens to be selected, ignoring
          // those doesn't make sense.
          this.props.onIgnoreFile(
            paths.filter(path => Path.basename(path) !== GitIgnoreFileName)
          )
        },
        // Enable this action as long as there's something selected which isn't
        // a .gitignore file.
        enabled: paths.some(path => Path.basename(path) !== GitIgnoreFileName),
      })
    }
    // Five menu items should be enough for everyone
    Array.from(extensions)
      .slice(0, 5)
      .forEach(extension => {
        items.push({
          label: __DARWIN__
            ? `Ignore All ${extension} Files (Add to .gitignore)`
            : `Ignore all ${extension} files (add to .gitignore)`,
          action: () => this.props.onIgnorePattern(`*${extension}`),
        })
      })

    if (paths.length > 1) {
      items.push(
        { type: 'separator' },
        {
          label: __DARWIN__
            ? 'Include Selected Files'
            : 'Include selected files',
          action: () => {
            selectedFiles.map(file => this.props.onIncludeChanged(file, true))
          },
        },
        {
          label: __DARWIN__
            ? 'Exclude Selected Files'
            : 'Exclude selected files',
          action: () => {
            selectedFiles.map(file => this.props.onIncludeChanged(file, false))
          },
        },
        { type: 'separator' },
        this.getCopySelectedPathsMenuItem(selectedFiles),
        this.getCopySelectedRelativePathsMenuItem(selectedFiles)
      )
    } else {
      items.push(
        { type: 'separator' },
        this.getCopyPathMenuItem(file),
        this.getCopyRelativePathMenuItem(file)
      )
    }

    const enabled = status.kind !== AppFileStatusKind.Deleted
    items.push(
      { type: 'separator' },
      this.getRevealInFileManagerMenuItem(file),
      this.getOpenInExternalEditorMenuItem(file, enabled),
      {
        label: OpenWithDefaultProgramLabel,
        action: () => this.props.onOpenItem(path),
        enabled: enabled && isSafeExtension,
      }
    )

    return items
  }

  private getRebaseContextMenu(
    file: WorkingDirectoryFileChange
  ): ReadonlyArray<IMenuItem> {
    const { path, status } = file

    const extension = Path.extname(path)
    const isSafeExtension = isSafeFileExtension(extension)

    const items = new Array<IMenuItem>()

    if (file.status.kind === AppFileStatusKind.Untracked) {
      items.push(this.getDiscardChangesMenuItem([file.path]), {
        type: 'separator',
      })
    }

    const enabled = status.kind !== AppFileStatusKind.Deleted

    items.push(
      this.getCopyPathMenuItem(file),
      this.getCopyRelativePathMenuItem(file),
      { type: 'separator' },
      this.getRevealInFileManagerMenuItem(file),
      this.getOpenInExternalEditorMenuItem(file, enabled),
      {
        label: OpenWithDefaultProgramLabel,
        action: () => this.props.onOpenItem(path),
        enabled: enabled && isSafeExtension,
      }
    )

    return items
  }

  private onItemContextMenu = (
    item: IChangesListItem,
    event: React.MouseEvent<HTMLDivElement>
  ) => {
    const file = item.change

    // Folder rows (tree view) have no context menu.
    if (file === undefined) {
      return
    }

    if (this.props.isCommitting) {
      return
    }

    event.preventDefault()

    const items =
      this.props.rebaseConflictState === null
        ? this.getDefaultContextMenu(file)
        : this.getRebaseContextMenu(file)

    showContextualMenu(items)
  }

  private getPlaceholderMessage(
    files: ReadonlyArray<WorkingDirectoryFileChange>,
    prepopulateCommitSummary: boolean
  ) {
    if (!prepopulateCommitSummary) {
      return 'Summary (required)'
    }

    const firstFile = files[0]
    const fileName = basename(firstFile.path)

    switch (firstFile.status.kind) {
      case AppFileStatusKind.New:
      case AppFileStatusKind.Untracked:
        return `Create ${fileName}`
      case AppFileStatusKind.Deleted:
        return `Delete ${fileName}`
      default:
        // TODO:
        // this doesn't feel like a great message for AppFileStatus.Copied or
        // AppFileStatus.Renamed but without more insight (and whether this
        // affects other parts of the flow) we can just default to this for now
        return `Update ${fileName}`
    }
  }

  private onScroll = (scrollTop: number, _clientHeight: number) => {
    this.props.onChangesListScrolled(scrollTop)
  }

  private renderCommitMessageForm = (): JSX.Element => {
    const {
      rebaseConflictState,
      workingDirectory,
      repository,
      repositoryAccount,
      dispatcher,
      isCommitting,
      hookProgress,
      isGeneratingCommitMessage,
      commitToAmend,
      currentBranchProtected,
      currentRepoRulesInfo: currentRepoRulesInfo,
      shouldShowGenerateCommitMessageCallOut,
    } = this.props

    if (rebaseConflictState !== null) {
      const hasUntrackedChanges = workingDirectory.files.some(
        f => f.status.kind === AppFileStatusKind.Untracked
      )

      return (
        <ContinueRebase
          dispatcher={dispatcher}
          repository={repository}
          rebaseConflictState={rebaseConflictState}
          workingDirectory={workingDirectory}
          isCommitting={isCommitting}
          hasUntrackedChanges={hasUntrackedChanges}
        />
      )
    }

    const fileCount = workingDirectory.files.length

    // Files selected to commit (to be committed) (not selected to see in diff)
    const filesSelected = workingDirectory.files.filter(
      f => f.selection.getSelectionType() !== DiffSelectionType.None
    )

    const anyFilesSelected = filesSelected.length > 0

    // When a single file is selected, we use a default commit summary
    // based on the file name and change status.
    // However, for onboarding tutorial repositories, we don't want to do this.
    // See https://github.com/desktop/desktop/issues/8354
    const prepopulateCommitSummary =
      filesSelected.length === 1 && !repository.isTutorialRepository

    // if this is not a github repo, we don't want to
    // restrict what the user can do at all
    const hasWritePermissionForRepository =
      this.props.repository.gitHubRepository === null ||
      hasWritePermission(this.props.repository.gitHubRepository)

    const showPromptForCommittingFileHiddenByFilter =
      this.props.askForConfirmationOnCommitFilteredChanges &&
      isCommittingFileHiddenByFilter(
        filesSelected.map(f => f.id),
        this.state.filteredItems,
        fileCount,
        this.props.fileListFilter
      )

    return (
      <CommitMessage
        showAvatar={this.props.showCommitAvatar}
        showActionBar={this.props.showCommitActionBar}
        onCreateCommit={this.props.onCreateCommit}
        branch={this.props.branch}
        mostRecentLocalCommit={this.props.mostRecentLocalCommit}
        commitAuthor={this.props.commitAuthor}
        isShowingModal={this.props.isShowingModal}
        isShowingFoldout={this.props.isShowingFoldout}
        anyFilesSelected={anyFilesSelected}
        showPromptForCommittingFileHiddenByFilter={
          showPromptForCommittingFileHiddenByFilter
        }
        anyFilesAvailable={fileCount > 0}
        filesSelected={filesSelected}
        filesToBeCommittedCount={filesSelected.length}
        repository={repository}
        repositoryAccount={repositoryAccount}
        commitMessage={this.props.commitMessage}
        focusCommitMessage={this.props.focusCommitMessage}
        autocompletionProviders={this.props.autocompletionProviders}
        isCommitting={isCommitting}
        hookProgress={hookProgress}
        onShowCommitProgress={this.props.onShowCommitProgress}
        isGeneratingCommitMessage={isGeneratingCommitMessage}
        shouldShowGenerateCommitMessageCallOut={
          shouldShowGenerateCommitMessageCallOut
        }
        commitToAmend={commitToAmend}
        showCoAuthoredBy={this.props.showCoAuthoredBy}
        coAuthors={this.props.coAuthors}
        placeholder={this.getPlaceholderMessage(
          filesSelected,
          prepopulateCommitSummary
        )}
        prepopulateCommitSummary={prepopulateCommitSummary}
        key={repository.id}
        showBranchProtected={fileCount > 0 && currentBranchProtected}
        repoRulesInfo={currentRepoRulesInfo}
        aheadBehind={this.props.aheadBehind}
        showNoWriteAccess={fileCount > 0 && !hasWritePermissionForRepository}
        shouldNudge={this.props.shouldNudgeToCommit}
        commitSpellcheckEnabled={this.props.commitSpellcheckEnabled}
        showCommitLengthWarning={this.props.showCommitLengthWarning}
        onCoAuthorsUpdated={this.onCoAuthorsUpdated}
        onShowCoAuthoredByChanged={this.onShowCoAuthoredByChanged}
        onConfirmCommitWithUnknownCoAuthors={
          this.onConfirmCommitWithUnknownCoAuthors
        }
        onPersistCommitMessage={this.onPersistCommitMessage}
        onGenerateCommitMessage={this.onGenerateCommitMessage}
        onCommitMessageFocusSet={this.onCommitMessageFocusSet}
        onRefreshAuthor={this.onRefreshAuthor}
        onShowPopup={this.onShowPopup}
        onShowFoldout={this.onShowFoldout}
        onCommitSpellcheckEnabledChanged={this.onCommitSpellcheckEnabledChanged}
        onStopAmending={this.onStopAmending}
        onShowCreateForkDialog={this.onShowCreateForkDialog}
        onFilesToCommitNotVisible={this.onFilesToCommitNotVisible}
        accounts={this.props.accounts}
        onSuccessfulCommitCreated={this.onSuccessfulCommitCreated}
        submitButtonAriaDescribedBy={'hidden-changes-warning'}
        skipCommitHooks={this.props.skipCommitHooks}
        signOffCommits={this.props.signOffCommits}
        allowEmptyCommit={this.props.allowEmptyCommit}
        showAllowEmptyCommitOption={true}
        onUpdateCommitOptions={this.props.onUpdateCommitOptions}
      />
    )
  }

  private onSuccessfulCommitCreated = () => {
    this.clearFilter()
  }

  private onCoAuthorsUpdated = (coAuthors: ReadonlyArray<Author>) =>
    this.props.dispatcher.setCoAuthors(this.props.repository, coAuthors)

  private onShowCoAuthoredByChanged = (showCoAuthors: boolean) => {
    const { dispatcher, repository } = this.props
    dispatcher.setShowCoAuthoredBy(repository, showCoAuthors)
  }

  private onConfirmCommitWithUnknownCoAuthors = (
    coAuthors: ReadonlyArray<UnknownAuthor>,
    onCommitAnyway: () => void
  ) => {
    const { dispatcher } = this.props
    dispatcher.showUnknownAuthorsCommitWarning(coAuthors, onCommitAnyway)
  }

  private onRefreshAuthor = () =>
    this.props.dispatcher.refreshAuthor(this.props.repository)

  private onCommitMessageFocusSet = () =>
    this.props.dispatcher.setCommitMessageFocus(false)

  private onPersistCommitMessage = (message: ICommitMessage) =>
    this.props.dispatcher.setCommitMessage(this.props.repository, message)

  private onGenerateCommitMessage = (
    filesSelected: ReadonlyArray<WorkingDirectoryFileChange>,
    mustOverrideExistingMessage: boolean
  ) => {
    this.props.dispatcher.incrementMetric(
      'generateCommitMessageButtonClickCount'
    )

    return mustOverrideExistingMessage
      ? this.props.dispatcher.promptOverrideWithGeneratedCommitMessage(
          this.props.repository,
          filesSelected
        )
      : this.props.dispatcher.generateCommitMessage(
          this.props.repository,
          filesSelected
        )
  }

  private onShowPopup = (p: Popup) => this.props.dispatcher.showPopup(p)
  private onShowFoldout = (f: Foldout) => this.props.dispatcher.showFoldout(f)

  private onCommitSpellcheckEnabledChanged = (enabled: boolean) =>
    this.props.dispatcher.setCommitSpellcheckEnabled(enabled)

  private onStopAmending = () =>
    this.props.dispatcher.stopAmendingRepository(this.props.repository)

  private onShowCreateForkDialog = () => {
    if (isRepositoryWithGitHubRepository(this.props.repository)) {
      this.props.dispatcher.showCreateForkDialog(this.props.repository)
    }
  }

  private onStashEntryClicked = () => {
    const { isShowingStashEntry, dispatcher, repository } = this.props

    if (isShowingStashEntry) {
      dispatcher.selectWorkingDirectoryFiles(repository)

      // If the button is clicked, that implies the stash was not restored or discarded
      dispatcher.incrementMetric('noActionTakenOnStashCount')
    } else {
      dispatcher.selectStashedFile(repository)
      dispatcher.incrementMetric('stashViewCount')
    }
  }

  private renderStashedChanges() {
    if (this.props.stashEntry === null) {
      return null
    }

    const className = classNames(
      'stashed-changes-button',
      this.props.isShowingStashEntry ? 'selected' : null
    )

    return (
      <button
        className={className}
        onClick={this.onStashEntryClicked}
        tabIndex={0}
        aria-expanded={this.props.isShowingStashEntry}
        aria-controls={
          this.props.isShowingStashEntry ? StashDiffViewerId : undefined
        }
      >
        <Octicon className="stack-icon" symbol={StashIcon} />
        <div className="text">Stashed Changes</div>
        <Octicon symbol={octicons.chevronRight} />
      </button>
    )
  }

  private onChangedFileDoubleClick = (item: IChangesListItem) => {
    if (item.change === undefined) {
      return
    }
    this.props.onOpenItemInExternalEditor(item.change.path)
  }

  private onItemKeyDown = (
    item: IChangesListItem,
    event: React.KeyboardEvent<HTMLDivElement>
  ) => {
    // The commit is already in-flight but this check prevents the
    // user from changing selection.
    if (
      this.props.isCommitting &&
      (event.key === 'Enter' || event.key === ' ')
    ) {
      event.preventDefault()
    }

    // In the tree view, the arrow keys expand/collapse the focused folder.
    const node = item.treeNode
    if (node?.kind === 'folder') {
      if (event.key === 'ArrowRight') {
        this.setFolderExpanded(node.path, true)
        event.preventDefault()
      } else if (event.key === 'ArrowLeft') {
        this.setFolderExpanded(node.path, false)
        event.preventDefault()
      }
    }

    return
  }

  public focus() {
    if (this.props.showChangesFilter) {
      this.filterOptionsButtonRef?.focus()
      return
    }

    this.includeAllCheckBoxRef.current?.focus()
  }

  private onChangedFileClick = (
    item: IChangesListItem,
    source: ClickSource
  ) => {
    const node = item.treeNode

    if (node?.kind === 'folder') {
      // Pressing space/enter toggles inclusion (matching file rows), while a
      // mouse click expands/collapses the folder.
      if (source.kind === 'keyboard') {
        this.toggleFolderInclude(node)
      } else {
        // A click on the include checkbox is handled by its own change event;
        // don't also expand/collapse the folder in that case.
        const target = source.event.target as HTMLElement
        if (target.closest('.checkbox-component') === null) {
          this.toggleFolderExpanded(node.path)
        }
      }
      return
    }

    if (item.change === undefined) {
      return
    }

    const fileIndex = this.props.workingDirectory.findFileIndexByID(
      item.change.id
    )

    this.props.onRowClick?.(fileIndex, source)
  }

  private onFilterTextChanged = (text: string) => {
    if (this.props.fileListFilter.filterText === '' && text !== '') {
      this.props.dispatcher.incrementMetric('typedInChangesFilterCount')
    }

    this.props.dispatcher.setChangesListFilterText(this.props.repository, text)
  }

  private onFilterListResultsChanged = (
    filteredItems: ReadonlyArray<IChangesListItem>
  ) => {
    // In the tree view we manage `filteredItems` ourselves (folder rows must
    // not be counted as changed files), so ignore the list's callback.
    if (this.props.showChangesAsTree) {
      return
    }

    const filteredSet = new Map<string, IChangesListItem>()
    filteredItems.forEach(f => filteredSet.set(f.id, f))
    this.setState({ filteredItems: filteredSet })
  }

  private onFileSelectionChanged = (items: ReadonlyArray<IChangesListItem>) => {
    const fileItems = items.filter(i => i.change !== undefined)

    // Selecting a folder row (e.g. clicking to expand it) shouldn't change the
    // displayed diff, so preserve the current file selection in that case.
    if (fileItems.length === 0 && items.length > 0) {
      return
    }

    const rows = fileItems.map(i =>
      this.props.workingDirectory.findFileIndexByID(i.change!.id)
    )
    this.props.onFileSelectionChanged(rows)
  }

  private onFilesToCommitNotVisible = (onCommitAnyway: () => void) => {
    this.props.dispatcher.showPopup({
      type: PopupType.ConfirmCommitFilteredChanges,
      onCommitAnyway,
      showFilesToBeCommitted: this.showFilesToBeCommitted,
    })
  }

  private clearFilter = () => {
    this.props.dispatcher.setChangesListFilterText(this.props.repository, '')
  }

  private showFilesToBeCommitted = () => {
    this.props.dispatcher.incrementMetric(
      'adjustedFiltersForHiddenChangesCount'
    )
    // Clear all filters first to ensure all files are visible
    this.clearFilter()
    this.props.dispatcher.setFilterExcludedFiles(this.props.repository, false)
    this.props.dispatcher.setFilterNewFiles(this.props.repository, false)
    this.props.dispatcher.setFilterModifiedFiles(this.props.repository, false)
    this.props.dispatcher.setFilterDeletedFiles(this.props.repository, false)

    // Then apply only the "Included in commit" filter to show only files being committed
    this.props.dispatcher.setIncludedChangesInCommitFilter(
      this.props.repository,
      true
    )
  }

  private onTextBoxRef = (component: TextBox | null) => {
    this.filterTextBox = component ?? undefined
  }

  private onFilterKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (this.filterListRef.current) {
      this.filterListRef.current.onKeyDown(event)
    }
  }

  private renderFilterRow = () => {
    // Nothing left to put in it, so the row goes rather than sitting there as an
    // empty band above the list.
    if (!this.props.showChangesFilter && !this.props.showChangesListHeader) {
      return null
    }

    return (
      <div
        className="header filter-field-row"
        onContextMenu={this.onContextMenu}
        ref={this.headerRef}
      >
        {this.renderFilterBox()}
        {this.props.showChangesListHeader && this.renderCheckBoxRow()}
      </div>
    )
  }

  private renderCheckBoxRow = () => {
    const { workingDirectory, rebaseConflictState, isCommitting } = this.props
    const { files } = workingDirectory

    const visibleFiles = this.state.filteredItems.size

    const includeAllValue = this.getCheckAllValue(
      workingDirectory,
      rebaseConflictState,
      this.state.filteredItems
    )

    const disableAllCheckbox =
      files.length === 0 || isCommitting || rebaseConflictState !== null

    const checkAllLabel = `${
      visibleFiles !== files.length ? `${formatNumber(visibleFiles)} of ` : ''
    }
    ${formatNumber(files.length)} changed file${plural(files.length)}`

    const showingTree = this.props.showChangesAsTree
    const viewToggleLabel = showingTree
      ? 'Show changes as a list'
      : 'Show changes as a tree'

    const filesFirst = this.props.changesTreeFilesFirst
    const sortToggleLabel = filesFirst
      ? 'Showing files before subfolders (click to show subfolders first)'
      : 'Showing subfolders before files (click to show files first)'

    return (
      <div className="checkbox-container">
        <Checkbox
          ref={this.includeAllCheckBoxRef}
          value={includeAllValue}
          onChange={this.onIncludeAllChanged}
          disabled={disableAllCheckbox}
          ariaLabelledBy="changes-list-check-all-label"
          className="changes-list-check-all"
          label={checkAllLabel}
        />
        {showingTree && (
          <Button
            className="changes-list-view-toggle"
            onClick={this.onToggleSortOrder}
            tooltip={sortToggleLabel}
            ariaLabel={sortToggleLabel}
            ariaPressed={filesFirst}
          >
            <Octicon
              symbol={filesFirst ? octicons.arrowUp : octicons.arrowDown}
            />
          </Button>
        )}
        <Button
          className="changes-list-view-toggle"
          onClick={this.onToggleViewMode}
          tooltip={viewToggleLabel}
          ariaLabel={viewToggleLabel}
          ariaPressed={showingTree}
        >
          <Octicon
            symbol={
              showingTree ? octicons.listUnordered : octicons.fileDirectory
            }
          />
        </Button>
      </div>
    )
  }

  private onToggleViewMode = () => {
    this.props.dispatcher.toggleChangesListViewMode()
  }

  private onToggleSortOrder = () => {
    this.props.dispatcher.toggleChangesTreeSortOrder()
  }

  private renderFilterBox = () => {
    if (!this.props.showChangesFilter) {
      return null
    }

    return (
      <div className="filter-box-container">
        <span>
          <ChangesListFilterOptions
            fileListFilter={this.props.fileListFilter}
            filteredItems={this.state.filteredItems}
            onFilterToIncludedInCommit={this.onFilterToIncludedInCommit}
            onFilterExcludedFiles={this.onFilterExcludedFiles}
            onFilterDeletedFiles={this.onFilterDeletedFiles}
            onFilterModifiedFiles={this.onFilterModifiedFiles}
            onFilterNewFiles={this.onFilterNewFiles}
            onClearAllFilters={this.onClearAllFilters}
            workingDirectory={this.props.workingDirectory}
          />
        </span>
        <TextBox
          ref={this.onTextBoxRef}
          displayClearButton={true}
          placeholder={'Filter'}
          className="filter-list-filter-field"
          onValueChanged={this.onFilterTextChanged}
          onKeyDown={this.onFilterKeyDown}
          value={this.props.fileListFilter.filterText}
        />
      </div>
    )
  }

  private applyFilters = (item: IChangesListItem) => {
    return applyFilters(
      item,
      this.props.showChangesFilter,
      this.props.fileListFilter
    )
  }

  private getListAriaLabel = () => {
    const { files } = this.props.workingDirectory
    return `${formatNumber(files.length)} changed file${plural(files.length)}`
  }

  public render() {
    const { workingDirectory, isCommitting } = this.props

    return (
      <>
        <div className="changes-list-container file-list filtered-changes-list">
          <AugmentedSectionFilterList<IChangesListItem>
            ref={this.filterListRef}
            id="changes-list"
            rowHeight={RowHeight}
            filterText={
              // In the tree view we filter the files ourselves before building
              // the tree, so the list must not re-filter (it would hide folder
              // rows whose names don't match).
              this.props.showChangesAsTree
                ? ''
                : this.props.showChangesFilter
                ? this.props.fileListFilter.filterText
                : ''
            }
            filterTextBox={this.filterTextBox}
            onFilterListResultsChanged={this.onFilterListResultsChanged}
            selectedItems={this.state.selectedItems}
            selectionMode="multi"
            renderItem={this.renderChangedFile}
            onItemClick={this.onChangedFileClick}
            onItemDoubleClick={this.onChangedFileDoubleClick}
            onItemKeyboardFocus={this.onChangedFileFocus}
            onItemBlur={this.onChangedFileBlur}
            onScroll={this.onScroll}
            setScrollTop={this.props.changesListScrollTop}
            onItemKeyDown={this.onItemKeyDown}
            onSelectionChanged={this.onFileSelectionChanged}
            groups={this.state.groups}
            filterMethod={
              this.props.showChangesAsTree
                ? undefined
                : this.props.fileListFilter.isIncludedInCommit ||
                  this.props.fileListFilter.isNewFile ||
                  this.props.fileListFilter.isModifiedFile ||
                  this.props.fileListFilter.isDeletedFile ||
                  this.props.fileListFilter.isExcludedFromCommit
                ? this.applyFilters
                : undefined
            }
            invalidationProps={{
              workingDirectory: workingDirectory,
              isCommitting: isCommitting,
              focusedRow: this.state.focusedRow,
              showChangesFilter: this.props.showChangesFilter,
              showChangesAsTree: this.props.showChangesAsTree,
              changesTreeFilesFirst: this.props.changesTreeFilesFirst,
              collapsedFolders: this.state.collapsedFolders,
              filterNewFiles: this.props.fileListFilter.isNewFile,
              filterModifiedFiles: this.props.fileListFilter.isModifiedFile,
              filterDeletedFiles: this.props.fileListFilter.isDeletedFile,
              filterExcludedFiles:
                this.props.fileListFilter.isExcludedFromCommit,
            }}
            onItemContextMenu={this.onItemContextMenu}
            renderCustomFilterRow={this.renderFilterRow}
            getGroupAriaLabel={this.getListAriaLabel}
            renderNoItems={this.renderNoChanges}
            postNoResultsMessage={getNoResultsMessage(
              this.props.fileListFilter
            )}
          />
        </div>
        {this.renderStashedChanges()}
        {this.renderHiddenChangesWarning()}
        {this.renderCommitMessageForm()}
      </>
    )
  }

  private renderHiddenChangesWarning = () => {
    const { files } = this.props.workingDirectory
    const filesSelected = files.filter(
      f => f.selection.getSelectionType() !== DiffSelectionType.None
    )

    if (
      !isCommittingFileHiddenByFilter(
        filesSelected.map(f => f.id),
        this.state.filteredItems,
        files.length,
        this.props.fileListFilter
      )
    ) {
      return null
    }

    return (
      <div className="hidden-changes-warning" id="hidden-changes-warning">
        <Octicon symbol={octicons.alert} />
        <span className="sr-only">Warning:</span>
        <span>Hidden changes will be committed. </span>
        <LinkButton onClick={this.showFilesToBeCommitted}>
          Adjust the filters to see all {formatNumber(filesSelected.length)}{' '}
          changes
        </LinkButton>
      </div>
    )
  }

  private renderNoChanges = () => {
    if (!hasActiveFilters(this.props.fileListFilter)) {
      return null
    }

    // Check if any filters are active (including text filter)
    const filtersActive = hasActiveFilters(this.props.fileListFilter)

    const BlankSlateImage = encodePathAsUrl(
      __dirname,
      'static/empty-no-file-selected.svg'
    )

    return (
      <div className="no-changes-filtered">
        <img src={BlankSlateImage} className="blankslate-image" alt="" />

        <div className="title">No files match your current filters</div>

        <div className="subtitle">
          {getNoResultsMessage(this.props.fileListFilter)}
        </div>

        {filtersActive && (
          <Button
            className="clear-filters-button"
            onClick={this.onClearAllFilters}
          >
            Clear filters
          </Button>
        )}
      </div>
    )
  }

  private onFilterToIncludedInCommit = () => {
    if (!this.props.fileListFilter.isIncludedInCommit) {
      this.props.dispatcher.incrementMetric(
        'appliesIncludedInCommitFilterCount'
      )
    }
    this.props.dispatcher.setIncludedChangesInCommitFilter(
      this.props.repository,
      !this.props.fileListFilter.isIncludedInCommit
    )
  }

  private onFilterNewFiles = () => {
    if (!this.props.fileListFilter.isNewFile) {
      this.props.dispatcher.incrementMetric('appliesNewFilesChangesFilterCount')
    }
    this.props.dispatcher.setFilterNewFiles(
      this.props.repository,
      !this.props.fileListFilter.isNewFile
    )
  }

  private onFilterModifiedFiles = () => {
    if (!this.props.fileListFilter.isModifiedFile) {
      this.props.dispatcher.incrementMetric(
        'appliesModifiedFilesChangesFilterCount'
      )
    }
    this.props.dispatcher.setFilterModifiedFiles(
      this.props.repository,
      !this.props.fileListFilter.isModifiedFile
    )
  }

  private onFilterDeletedFiles = () => {
    if (!this.props.fileListFilter.isDeletedFile) {
      this.props.dispatcher.incrementMetric(
        'appliesDeletedFilesChangesFilterCount'
      )
    }
    this.props.dispatcher.setFilterDeletedFiles(
      this.props.repository,
      !this.props.fileListFilter.isDeletedFile
    )
  }

  private onFilterExcludedFiles = () => {
    if (!this.props.fileListFilter.isExcludedFromCommit) {
      this.props.dispatcher.incrementMetric(
        'appliesExcludedFromCommitFilterCount'
      )
    }
    this.props.dispatcher.setFilterExcludedFiles(
      this.props.repository,
      !this.props.fileListFilter.isExcludedFromCommit
    )
  }

  private onClearAllFilters = () => {
    this.props.dispatcher.incrementMetric(
      'appliesClearAllChangesListFilterCount'
    )

    // Clear all filters including text filter
    this.props.dispatcher.setChangesListFilterText(this.props.repository, '')
    this.props.dispatcher.setIncludedChangesInCommitFilter(
      this.props.repository,
      false
    )
    this.props.dispatcher.setFilterExcludedFiles(this.props.repository, false)
    this.props.dispatcher.setFilterNewFiles(this.props.repository, false)
    this.props.dispatcher.setFilterModifiedFiles(this.props.repository, false)
    this.props.dispatcher.setFilterDeletedFiles(this.props.repository, false)
  }

  private onChangedFileFocus = (changeListItem: IChangesListItem) => {
    this.setState({ focusedRow: changeListItem.id })
  }

  private onChangedFileBlur = (changeListItem: IChangesListItem) => {
    if (this.state.focusedRow === changeListItem.id) {
      this.setState({ focusedRow: null })
    }
  }
}
