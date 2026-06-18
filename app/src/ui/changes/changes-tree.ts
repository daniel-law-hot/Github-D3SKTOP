import { WorkingDirectoryFileChange } from '../../models/status'

/**
 * A node in the flattened, display-ordered representation of the changes tree.
 *
 * Folder nodes are expandable rows; file nodes are leaves. Both carry a `depth`
 * used to indent the row in the UI.
 */
export type ChangesTreeNode =
  | {
      readonly kind: 'folder'
      /** Stable identifier for the row — the folder's full path from the repo root. */
      readonly id: string
      /** The last path segment, e.g. `ui` for `app/src/ui`. */
      readonly name: string
      /** The folder's full path from the repo root, e.g. `app/src/ui`. */
      readonly path: string
      readonly depth: number
      /** Every file change contained anywhere beneath this folder. */
      readonly files: ReadonlyArray<WorkingDirectoryFileChange>
    }
  | {
      readonly kind: 'file'
      /** Stable identifier for the row — the file change id. */
      readonly id: string
      readonly depth: number
      readonly change: WorkingDirectoryFileChange
    }

/** An immutable folder node in the changes tree. */
export interface IChangesFolderNode {
  /** The last path segment (empty string for the synthetic root). */
  readonly name: string
  /** The folder's full path from the repo root (empty string for the root). */
  readonly path: string
  /** Direct child folders, sorted case-insensitively by name. */
  readonly folders: ReadonlyArray<IChangesFolderNode>
  /** Files directly within this folder, sorted case-insensitively by name. */
  readonly files: ReadonlyArray<WorkingDirectoryFileChange>
}

interface IMutableFolderNode {
  name: string
  path: string
  readonly folders: Map<string, IMutableFolderNode>
  readonly files: Array<WorkingDirectoryFileChange>
}

function compareName(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: 'accent', numeric: true })
}

function basename(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1]
}

function finalize(folder: IMutableFolderNode): IChangesFolderNode {
  const folders = Array.from(folder.folders.values())
    .map(finalize)
    .sort((a, b) => compareName(a.name, b.name))

  const files = [...folder.files].sort((a, b) =>
    compareName(basename(a.path), basename(b.path))
  )

  return { name: folder.name, path: folder.path, folders, files }
}

/**
 * Build a folder tree from a flat list of working directory file changes.
 *
 * Paths are split on `/` (git always reports forward slashes). The returned
 * value is the synthetic root node whose `folders`/`files` are the top-level
 * entries. Folders and files are each sorted case-insensitively by name.
 */
export function buildChangesTree(
  files: ReadonlyArray<WorkingDirectoryFileChange>
): IChangesFolderNode {
  const root: IMutableFolderNode = {
    name: '',
    path: '',
    folders: new Map(),
    files: [],
  }

  for (const file of files) {
    const segments = file.path.split('/')
    // The last segment is the file name; everything before it is the directory.
    segments.pop()

    let current = root
    let prefix = ''

    for (const segment of segments) {
      if (segment === '') {
        continue
      }

      prefix = prefix === '' ? segment : `${prefix}/${segment}`

      let next = current.folders.get(segment)
      if (next === undefined) {
        next = { name: segment, path: prefix, folders: new Map(), files: [] }
        current.folders.set(segment, next)
      }
      current = next
    }

    current.files.push(file)
  }

  return finalize(root)
}

function compactFolder(folder: IChangesFolderNode): IChangesFolderNode {
  // Walk down through folders that contain nothing but a single subfolder,
  // joining their names into a single chained path (e.g. `app/src/lib`). The
  // chain stops as soon as a folder branches — i.e. it has files of its own or
  // more than one subfolder.
  let name = folder.name
  let current = folder

  while (current.files.length === 0 && current.folders.length === 1) {
    const child = current.folders[0]
    name = `${name}/${child.name}`
    current = child
  }

  return {
    name,
    // Keep the deepest folder's full path as the node's identity so collapse
    // state and selection remain stable.
    path: current.path,
    files: current.files,
    folders: current.folders.map(compactFolder),
  }
}

/**
 * Collapse chains of single-child folders into a single node, so that e.g.
 * `app/src/lib/stores/{a,b}` renders as one `app/src/lib/stores` row rather
 * than four nested rows. Chains stop wherever the tree branches.
 *
 * The synthetic root is never merged into its children — only the folders
 * beneath it are compacted.
 */
export function compactChangesTree(
  root: IChangesFolderNode
): IChangesFolderNode {
  return {
    ...root,
    folders: root.folders.map(compactFolder),
  }
}

function collectFiles(
  folder: IChangesFolderNode
): ReadonlyArray<WorkingDirectoryFileChange> {
  const result = [...folder.files]
  for (const child of folder.folders) {
    result.push(...collectFiles(child))
  }
  return result
}

/**
 * Flatten the tree into the ordered list of rows that should be displayed,
 * skipping the descendants of any folder whose path is in `collapsedFolders`.
 *
 * Within each folder, child folders are listed before files. Each folder row
 * carries the full set of descendant files so the UI can render a tri-state
 * include checkbox and toggle the whole subtree at once.
 */
export function flattenChangesTree(
  root: IChangesFolderNode,
  collapsedFolders: ReadonlySet<string>
): ReadonlyArray<ChangesTreeNode> {
  const rows: Array<ChangesTreeNode> = []

  const walk = (folder: IChangesFolderNode, depth: number) => {
    for (const child of folder.folders) {
      rows.push({
        kind: 'folder',
        id: child.path,
        name: child.name,
        path: child.path,
        depth,
        files: collectFiles(child),
      })

      if (!collapsedFolders.has(child.path)) {
        walk(child, depth + 1)
      }
    }

    for (const file of folder.files) {
      rows.push({ kind: 'file', id: file.id, depth, change: file })
    }
  }

  walk(root, 0)

  return rows
}
