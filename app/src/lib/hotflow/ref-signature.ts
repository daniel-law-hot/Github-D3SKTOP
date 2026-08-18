import { GitError } from 'dugite'
import { Repository } from '../../models/repository'
import { git } from '../git/core'

/**
 * A fingerprint of everything HotFlow's picture is derived from.
 *
 * The release view is a pure function of refs — which branches exist, where they
 * point, which tags are on production — so anything that moves a ref makes it
 * stale, and nothing else can. Rather than remembering to refresh after each of
 * the twenty-odd operations that move one, `AppStore` compares this against the
 * fingerprint taken at the last read and refreshes when they differ.
 *
 * That distinction matters because it's the difference between a refresh that has
 * to be maintained and one that can't be forgotten. Four bugs in one week came
 * from a mutation whose author had no reason to know HotFlow existed: a merged
 * branch that stayed in the lane, a new branch that never appeared, a freshly cut
 * release reported as shipped, and a push that left its own marking behind.
 *
 * One `for-each-ref` — cheap next to the dozen or so reads a full detection
 * costs, which is the point: this runs often and detection then runs rarely.
 *
 * Note this deliberately says nothing about HEAD. A checkout moves no ref but
 * does change which release is current, so the caller folds the tip in from state
 * it has already loaded, rather than paying for another git process here.
 */
export async function readRefSignature(
  repository: Repository
): Promise<string | null> {
  const result = await git(
    [
      'for-each-ref',
      '--format=%(objectname)%(refname)',
      'refs/heads',
      'refs/remotes',
      'refs/tags',
    ],
    repository.path,
    'hotFlowRefSignature',
    {
      expectedErrors: new Set([GitError.NotAGitRepository]),
      successExitCodes: new Set([0, 1]),
    }
  )

  if (result.gitError !== null) {
    return null
  }

  // Hashed rather than kept whole: a repository with thousands of refs would
  // otherwise hold a megabyte of string per repository for no reason, and only
  // equality is ever asked of it. FNV-1a, because a cryptographic digest would
  // be answering a question nobody asked — nothing adversarial reaches this, and
  // a collision costs one missed refresh rather than anything unsafe.
  let hash = 0x811c9dc5

  for (let i = 0; i < result.stdout.length; i++) {
    hash ^= result.stdout.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }

  // Length alongside the hash: two cheap independent signals beat one.
  return `${result.stdout.length}:${(hash >>> 0).toString(16)}`
}
