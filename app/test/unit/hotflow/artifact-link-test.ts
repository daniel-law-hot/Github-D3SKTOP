import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  extractLinkedCommitShas,
  IWorkItemRelation,
} from '../../../src/lib/hotflow/ado-client'

function artifact(name: string, url: string): IWorkItemRelation {
  return { rel: 'ArtifactLink', url, attributes: { name } }
}

describe('extractLinkedCommitShas', () => {
  it('reads a commit link with the %2f separator Azure DevOps actually stores', () => {
    // Verbatim from work item 106916. The separator between the repository guid
    // and the sha is percent-encoded while the slashes before it are not, and a
    // pattern expecting a literal slash there silently matches nothing — which
    // reads downstream as "this work item has no commits anywhere".
    const relations = [
      artifact(
        'GitHub Commit',
        'vstfs:///GitHub/Commit/a23a015c-a16c-4178-9c31-1e9cdde983d6%2f0d82cde9499cd94e4d8f31832b09fa42795e9216'
      ),
    ]

    assert.deepStrictEqual(extractLinkedCommitShas(relations), [
      '0d82cde9499cd94e4d8f31832b09fa42795e9216',
    ])
  })

  it('accepts an uppercase %2F too', () => {
    const relations = [
      artifact(
        'GitHub Commit',
        'vstfs:///GitHub/Commit/a23a015c-a16c-4178-9c31-1e9cdde983d6%2F0d82cde9499cd94e4d8f31832b09fa42795e9216'
      ),
    ]

    assert.strictEqual(extractLinkedCommitShas(relations).length, 1)
  })

  it('accepts a literal slash, in case the encoding ever changes', () => {
    const relations = [
      artifact(
        'GitHub Commit',
        'vstfs:///GitHub/Commit/a23a015c-a16c-4178-9c31-1e9cdde983d6/0d82cde9499cd94e4d8f31832b09fa42795e9216'
      ),
    ]

    assert.strictEqual(extractLinkedCommitShas(relations).length, 1)
  })

  it('ignores pull request, build and release links', () => {
    // All real forms from the same work item. Only commits resolve locally, and a
    // pull request number would collide across repositories anyway.
    const relations = [
      artifact(
        'GitHub Pull Request',
        'vstfs:///GitHub/PullRequest/efcd8e7e-08ed-453f-99ca-87c31bf5d7bb%2f37'
      ),
      artifact('Integrated in build', 'vstfs:///Build/Build/27494'),
      artifact(
        'Integrated in release environment',
        'vstfs:///ReleaseManagement/ReleaseEnvironment/cc345a36-9ca7-4723-b816-60f46b4ea176:16252:51414'
      ),
    ]

    assert.deepStrictEqual(extractLinkedCommitShas(relations), [])
  })

  it('ignores non-artifact relations', () => {
    const relations: ReadonlyArray<IWorkItemRelation> = [
      {
        rel: 'System.LinkTypes.Related',
        url: 'https://dev.azure.com/houseoftravel/x/_apis/wit/workItems/106696',
        attributes: { name: 'Related' },
      },
      {
        rel: 'AttachedFile',
        url: 'https://dev.azure.com/houseoftravel/x/_apis/wit/attachments/abc',
        attributes: { name: 'spec.pdf' },
      },
    ]

    assert.deepStrictEqual(extractLinkedCommitShas(relations), [])
  })

  it('lower-cases and deduplicates', () => {
    const sha = '0D82CDE9499CD94E4D8F31832B09FA42795E9216'
    const relations = [
      artifact('GitHub Commit', `vstfs:///GitHub/Commit/guid-a%2f${sha}`),
      artifact(
        'GitHub Commit',
        `vstfs:///GitHub/Commit/guid-b%2f${sha.toLowerCase()}`
      ),
    ]

    assert.deepStrictEqual(extractLinkedCommitShas(relations), [
      sha.toLowerCase(),
    ])
  })

  it('collects every commit when a work item spans repositories', () => {
    // 106916 again: two commits in AmadeusWebApi, one in the Contracts repo.
    const relations = [
      artifact(
        'GitHub Commit',
        'vstfs:///GitHub/Commit/a23a015c-a16c-4178-9c31-1e9cdde983d6%2f0d82cde9499cd94e4d8f31832b09fa42795e9216'
      ),
      artifact(
        'GitHub Commit',
        'vstfs:///GitHub/Commit/a23a015c-a16c-4178-9c31-1e9cdde983d6%2f95138baf746e2215a7c6ee4937b528b79acfbca3'
      ),
      artifact(
        'GitHub Commit',
        'vstfs:///GitHub/Commit/efcd8e7e-08ed-453f-99ca-87c31bf5d7bb%2f0e59ca86100a339a59ff32f72642cd956e3ae69e'
      ),
    ]

    assert.strictEqual(extractLinkedCommitShas(relations).length, 3)
  })

  it('returns nothing for a work item with no relations', () => {
    assert.deepStrictEqual(extractLinkedCommitShas(undefined), [])
    assert.deepStrictEqual(extractLinkedCommitShas([]), [])
  })
})
