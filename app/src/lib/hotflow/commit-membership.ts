import { Repository } from '../../models/repository'
import { git } from '../git/core'

/**
 * Of the given commit SHAs, which ones this repository actually has.
 *
 * `cat-file --batch-check` reads SHAs on stdin and answers for all of them in one
 * process, which matters because a cycle can carry forty work items linking a few
 * commits each. Known objects print `<sha> commit <size>`; unknown ones print
 * `<sha> missing`, and it exits 0 either way — a missing object is an answer, not
 * a failure.
 *
 * "Has the object" rather than "is on a branch" is the right question here: the
 * caller is asking which repository a work item's work happened in, and a commit
 * sitting on a fetched remote branch answers that just as well as one on `main`.
 *
 * The one blind spot is a commit that was pushed but never fetched here. It reads
 * as absent, so a work item whose only link is that commit is treated as another
 * repository's. A fetch fixes it, and HotFlow's refresh is downstream of one.
 */
export async function getCommitsPresentInRepository(
  repository: Repository,
  shas: ReadonlyArray<string>
): Promise<ReadonlySet<string>> {
  const found = new Set<string>()

  if (shas.length === 0) {
    return found
  }

  // `^{commit}` rejects a sha that resolves to a blob or tree, which a truncated
  // or mistyped link can do.
  const stdin = shas.map(sha => `${sha}^{commit}`).join('\n') + '\n'

  const result = await git(
    ['cat-file', '--batch-check'],
    repository.path,
    'getCommitsPresentInRepository',
    { stdin, successExitCodes: new Set([0, 1]) }
  )

  // Lines come back in request order, so the sha is read from the input rather
  // than parsed out of the response — `missing` lines don't always echo it.
  const lines = result.stdout.split('\n')

  for (const [i, sha] of shas.entries()) {
    const line = lines[i]

    if (line !== undefined && / commit \d+$/.test(line.trim())) {
      found.add(sha.toLowerCase())
    }
  }

  return found
}
