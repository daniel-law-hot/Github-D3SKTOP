import { describe, it } from 'node:test'
import assert from 'node:assert'
import { AppFileStatusKind } from '../../../src/models/status'
import { DiffSelectionType } from '../../../src/models/diff'
import { WorkingDirectoryFileChange } from '../../../src/models/status'
import { DiffSelection } from '../../../src/models/diff'
import {
  buildChangesTree,
  compactChangesTree,
  flattenChangesTree,
  ChangesTreeNode,
} from '../../../src/ui/changes/changes-tree'

function createTestFile(path: string): WorkingDirectoryFileChange {
  return new WorkingDirectoryFileChange(
    path,
    { kind: AppFileStatusKind.Modified },
    DiffSelection.fromInitialSelection(DiffSelectionType.All)
  )
}

function flatten(
  paths: ReadonlyArray<string>,
  collapsed: ReadonlySet<string> = new Set()
): ReadonlyArray<ChangesTreeNode> {
  const tree = buildChangesTree(paths.map(createTestFile))
  return flattenChangesTree(tree, collapsed)
}

function flattenCompact(
  paths: ReadonlyArray<string>,
  collapsed: ReadonlySet<string> = new Set()
): ReadonlyArray<ChangesTreeNode> {
  const tree = compactChangesTree(buildChangesTree(paths.map(createTestFile)))
  return flattenChangesTree(tree, collapsed)
}

function describeRow(row: ChangesTreeNode): string {
  return row.kind === 'folder'
    ? `${'  '.repeat(row.depth)}[${row.path}]`
    : `${'  '.repeat(row.depth)}${row.change.path}`
}

// Describes a row by its display name (which differs from its path for
// compacted, chained folders).
function describeRowByName(row: ChangesTreeNode): string {
  return row.kind === 'folder'
    ? `${'  '.repeat(row.depth)}[${row.name}]`
    : `${'  '.repeat(row.depth)}${row.change.path}`
}

describe('changes-tree', () => {
  describe('buildChangesTree', () => {
    it('places repo-root files at depth 0 with no folder rows', () => {
      const rows = flatten(['README.md', 'package.json'])
      assert.deepStrictEqual(rows.map(describeRow), [
        'package.json',
        'README.md',
      ])
      assert.ok(rows.every(r => r.kind === 'file'))
    })

    it('nests files under their folders and indents by depth', () => {
      const rows = flatten([
        'app/src/ui/changes/filter-changes-list.tsx',
        'app/src/lib/path.ts',
      ])

      assert.deepStrictEqual(rows.map(describeRow), [
        '[app]',
        '  [app/src]',
        '    [app/src/lib]',
        '      app/src/lib/path.ts',
        '    [app/src/ui]',
        '      [app/src/ui/changes]',
        '        app/src/ui/changes/filter-changes-list.tsx',
      ])
    })

    it('lists child folders before files within a folder', () => {
      const rows = flatten(['src/index.ts', 'src/lib/util.ts'])
      assert.deepStrictEqual(rows.map(describeRow), [
        '[src]',
        '  [src/lib]',
        '    src/lib/util.ts',
        '  src/index.ts',
      ])
    })

    it('sorts folders and files case-insensitively', () => {
      const rows = flatten(['src/Zebra.ts', 'src/apple.ts', 'src/Mango.ts'])
      assert.deepStrictEqual(rows.map(describeRow), [
        '[src]',
        '  src/apple.ts',
        '  src/Mango.ts',
        '  src/Zebra.ts',
      ])
    })

    it('collects every descendant file onto a folder node', () => {
      const rows = flatten(['app/src/a.ts', 'app/src/ui/b.ts', 'app/test/c.ts'])
      const appFolder = rows.find(r => r.kind === 'folder' && r.path === 'app')
      assert.ok(appFolder && appFolder.kind === 'folder')
      assert.deepStrictEqual([...appFolder.files].map(f => f.path).sort(), [
        'app/src/a.ts',
        'app/src/ui/b.ts',
        'app/test/c.ts',
      ])
    })
  })

  describe('flattenChangesTree', () => {
    it('hides descendants of a collapsed folder', () => {
      const collapsed = new Set(['app/src'])
      const rows = flatten(
        ['app/src/ui/a.ts', 'app/src/b.ts', 'app/README.md'],
        collapsed
      )

      assert.deepStrictEqual(rows.map(describeRow), [
        '[app]',
        '  [app/src]',
        '  app/README.md',
      ])
    })

    it('still reports descendant files on a collapsed folder', () => {
      const collapsed = new Set(['app/src'])
      const rows = flatten(['app/src/ui/a.ts', 'app/src/b.ts'], collapsed)
      const srcFolder = rows.find(
        r => r.kind === 'folder' && r.path === 'app/src'
      )
      assert.ok(srcFolder && srcFolder.kind === 'folder')
      assert.strictEqual(srcFolder.files.length, 2)
    })

    it('lists files before subfolders when filesFirst is set', () => {
      const tree = buildChangesTree(
        ['src/index.ts', 'src/lib/util.ts'].map(createTestFile)
      )
      const rows = flattenChangesTree(tree, new Set(), true)
      assert.deepStrictEqual(rows.map(describeRow), [
        '[src]',
        '  src/index.ts',
        '  [src/lib]',
        '    src/lib/util.ts',
      ])
    })

    it('lists subfolders before files by default (filesFirst off)', () => {
      const tree = buildChangesTree(
        ['src/index.ts', 'src/lib/util.ts'].map(createTestFile)
      )
      const rows = flattenChangesTree(tree, new Set(), false)
      assert.deepStrictEqual(rows.map(describeRow), [
        '[src]',
        '  [src/lib]',
        '    src/lib/util.ts',
        '  src/index.ts',
      ])
    })
  })

  describe('compactChangesTree', () => {
    it('chains a straight line of single-child folders into one row', () => {
      const rows = flattenCompact([
        'app/src/lib/stores/file1.ts',
        'app/src/lib/stores/file2.ts',
      ])

      assert.deepStrictEqual(rows.map(describeRowByName), [
        '[app/src/lib/stores]',
        '  app/src/lib/stores/file1.ts',
        '  app/src/lib/stores/file2.ts',
      ])
    })

    it('stops chaining where the tree branches into multiple folders', () => {
      const rows = flattenCompact([
        'app/src/lib/stores/file1.ts',
        'app/src/lib/ui/file2.ts',
      ])

      assert.deepStrictEqual(rows.map(describeRowByName), [
        '[app/src/lib]',
        '  [stores]',
        '    app/src/lib/stores/file1.ts',
        '  [ui]',
        '    app/src/lib/ui/file2.ts',
      ])
    })

    it('stops chaining where a folder also contains files', () => {
      const rows = flattenCompact(['app/src/index.ts', 'app/src/lib/util.ts'])

      assert.deepStrictEqual(rows.map(describeRowByName), [
        '[app/src]',
        '  [lib]',
        '    app/src/lib/util.ts',
        '  app/src/index.ts',
      ])
    })

    it('keeps the deepest folder path as the chained node identity', () => {
      const rows = flattenCompact(['app/src/lib/a.ts'])
      const folder = rows.find(r => r.kind === 'folder')
      assert.ok(folder && folder.kind === 'folder')
      assert.strictEqual(folder.name, 'app/src/lib')
      assert.strictEqual(folder.path, 'app/src/lib')
      assert.strictEqual(folder.files.length, 1)
    })

    it('leaves repo-root files alongside a chained top-level folder', () => {
      const rows = flattenCompact(['app/src/lib/a.ts', 'README.md'])

      assert.deepStrictEqual(rows.map(describeRowByName), [
        '[app/src/lib]',
        '  app/src/lib/a.ts',
        'README.md',
      ])
    })
  })
})
