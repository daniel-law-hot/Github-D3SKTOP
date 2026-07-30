import { describe, it } from 'node:test'
import assert from 'node:assert'
import { IWorkItem } from '../../../src/models/hotflow'
import {
  collectLinkedCommitShas,
  scopeToRepository,
} from '../../../src/lib/hotflow/work-item-scope'

function workItem(id: number, shas: ReadonlyArray<string>): IWorkItem {
  return {
    id,
    title: `Work item ${id}`,
    workItemType: 'Bug',
    state: 'Ready for UAT',
    assignedTo: null,
    tags: [],
    releaseSequence: 202617,
    linkedCommitShas: shas,
  }
}

function itemMap(...items: ReadonlyArray<IWorkItem>) {
  return new Map(items.map(i => [i.id, i]))
}

describe('collectLinkedCommitShas', () => {
  it('gathers shas across the given ids', () => {
    const items = itemMap(workItem(1, ['aaa', 'bbb']), workItem(2, ['ccc']))

    assert.deepStrictEqual([...collectLinkedCommitShas([1, 2], items)].sort(), [
      'aaa',
      'bbb',
      'ccc',
    ])
  })

  it('deduplicates a commit two work items both link', () => {
    const items = itemMap(workItem(1, ['shared']), workItem(2, ['shared']))

    assert.deepStrictEqual(collectLinkedCommitShas([1, 2], items), ['shared'])
  })

  it('ignores ids with no detail', () => {
    const items = itemMap(workItem(1, ['aaa']))

    assert.deepStrictEqual(collectLinkedCommitShas([1, 999], items), ['aaa'])
  })
})

describe('scopeToRepository', () => {
  it('keeps a work item whose commit is in this repository', () => {
    const items = itemMap(workItem(104402, ['ours']))

    assert.deepStrictEqual(
      scopeToRepository([104402], items, new Set(['ours'])),
      [104402]
    )
  })

  it("drops a work item whose commits are all another repository's", () => {
    // The real case: 106916 links commits in AmadeusWebApi and
    // ContentOrchestration.Contracts, none in ContentOrchestration.
    const items = itemMap(workItem(106916, ['in-awa', 'in-contracts']))

    assert.deepStrictEqual(
      scopeToRepository([106916], items, new Set(['ours'])),
      []
    )
  })

  it('keeps a work item with one commit here and others elsewhere', () => {
    const items = itemMap(workItem(1, ['in-awa', 'ours']))

    assert.deepStrictEqual(scopeToRepository([1], items, new Set(['ours'])), [
      1,
    ])
  })

  it('keeps a work item nobody has started anywhere', () => {
    // No links at all is not evidence of belonging elsewhere, and hiding it
    // would make the release look readier than it is.
    const items = itemMap(workItem(1, []))

    assert.deepStrictEqual(scopeToRepository([1], items, new Set()), [1])
  })

  it('keeps an id Azure DevOps returned no detail for', () => {
    assert.deepStrictEqual(scopeToRepository([1], itemMap(), new Set()), [1])
  })

  it('keeps input order', () => {
    const items = itemMap(
      workItem(3, ['ours']),
      workItem(1, []),
      workItem(2, ['theirs'])
    )

    assert.deepStrictEqual(
      scopeToRepository([3, 1, 2], items, new Set(['ours'])),
      [3, 1]
    )
  })

  it('drops nothing when every sha resolves', () => {
    const items = itemMap(workItem(1, ['a']), workItem(2, ['b']))

    assert.deepStrictEqual(
      scopeToRepository([1, 2], items, new Set(['a', 'b'])),
      [1, 2]
    )
  })
})
