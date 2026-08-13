import { GitError } from 'dugite'
import { Branch, IAheadBehind } from '../../models/branch'
import { Commit } from '../../models/commit'
import { Repository } from '../../models/repository'
import { git } from '../git/core'
import { getBranches } from '../git/for-each-ref'
import { createForEachRefParser } from '../git/git-delimiter-parser'
import { getCommits } from '../git/log'
import { getMergeBase } from '../git/merge'
import { getSymbolicRef } from '../git/refs'
import { getRemoteHEAD } from '../git/remote'
import {
  getAheadBehind,
  revRange,
  revSymmetricDifference,
} from '../git/rev-list'
import { getStatus } from '../git/status'
import { getAllTags } from '../git/tag'
import { IProviderTag, IRepositoryProvider } from './repository-provider'

/**
 * The repository provider backed by a local clone, via dugite.
 *
 * This is what Desktop uses, and it is a straight lift of the git calls that
 * used to sit inline in `detect.ts` and `actions.ts` — same commands, same
 * error handling, same batching. The point of moving them was to name the
 * interface, not to change the answers.
 */
export class GitRepositoryProvider implements IRepositoryProvider {
  public readonly hasWorkingCopy = true

  public constructor(private readonly repository: Repository) {}

  public getBranches(): Promise<ReadonlyArray<Branch>> {
    return getBranches(this.repository)
  }

  public async getCheckedOutBranchName(): Promise<string | null> {
    const headRef = await getSymbolicRef(this.repository, 'HEAD')

    // `refs/heads/release/1.2026.17` -> `release/1.2026.17`. Null on a detached
    // HEAD, which simply means there's no explicit choice to honour.
    return headRef === null ? null : headRef.replace(/^refs\/heads\//, '')
  }

  public getDefaultBranchName(): Promise<string | null> {
    return getRemoteHEAD(this.repository, 'origin').catch(() => null)
  }

  /**
   * Answers "is this merged" for every branch in one process instead of one per
   * branch. That saving is the whole reason this method takes a list: asking
   * per branch was sixteen git processes in NimbleObt and the largest single
   * block in the refresh.
   *
   * The branches' full refs are passed to `for-each-ref` as patterns. An exact
   * refname is a valid pattern, so this is the same query the glob version ran,
   * narrowed to precisely the refs asked about.
   */
  public async getMergedBranches(
    intoRef: string,
    branches: ReadonlyArray<Branch>
  ): Promise<ReadonlySet<string>> {
    // An empty pattern list makes for-each-ref list every ref there is, which
    // would answer a question nobody asked.
    if (branches.length === 0) {
      return new Set()
    }

    const result = await git(
      [
        'for-each-ref',
        '--format=%(refname:short)',
        `--merged=${intoRef}`,
        ...branches.map(b => b.ref),
      ],
      this.repository.path,
      'hotFlowMergedRefs',
      {
        expectedErrors: new Set([GitError.NotAGitRepository]),
        successExitCodes: new Set([0, 1]),
      }
    )

    if (result.gitError === GitError.NotAGitRepository) {
      return new Set()
    }

    return new Set(
      result.stdout
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
    )
  }

  public async getMergedTags(
    intoRef: string
  ): Promise<ReadonlyArray<IProviderTag>> {
    const { formatArgs, parse } = createForEachRefParser({
      name: '%(refname:short)',
      sha: '%(objectname)',
      // Annotated tags carry taggerdate; lightweight tags fall back to the
      // commit's own date via creatordate.
      date: '%(creatordate:iso8601)',
    })

    const result = await git(
      ['for-each-ref', ...formatArgs, `--merged=${intoRef}`, 'refs/tags'],
      this.repository.path,
      'hotFlowReleaseHistory',
      {
        expectedErrors: new Set([GitError.NotAGitRepository]),
        successExitCodes: new Set([0, 1]),
      }
    )

    if (result.gitError === GitError.NotAGitRepository) {
      return []
    }

    const tags: Array<IProviderTag> = []

    for (const ref of parse(result.stdout)) {
      if (ref.name === undefined || ref.name.length === 0) {
        continue
      }

      const parsedDate = ref.date ? new Date(ref.date) : null

      tags.push({
        name: ref.name,
        sha: ref.sha,
        date:
          parsedDate !== null && !isNaN(parsedDate.valueOf())
            ? parsedDate
            : null,
      })
    }

    return tags
  }

  public async getAllTagNames(): Promise<ReadonlySet<string>> {
    return new Set((await getAllTags(this.repository)).keys())
  }

  public getAheadBehind(
    ref: string,
    otherRef: string
  ): Promise<IAheadBehind | null> {
    return getAheadBehind(
      this.repository,
      revSymmetricDifference(ref, otherRef)
    )
  }

  public async getCommitRange(
    from: string,
    to: string,
    limit: number
  ): Promise<ReadonlyArray<Commit>> {
    try {
      return await getCommits(this.repository, revRange(from, to), limit)
    } catch {
      // A bad range shouldn't take the whole view down — an empty list degrades
      // to "nothing here" rather than an error screen.
      return []
    }
  }

  public getMergeBase(ref: string, otherRef: string): Promise<string | null> {
    return getMergeBase(this.repository, ref, otherRef)
  }

  public async isWorkingTreeClean(): Promise<boolean | null> {
    const status = await getStatus(this.repository)

    // A null status means git couldn't tell us; treat that as not-clean rather
    // than assuming the best. Note this returns false, not null — null is
    // reserved for "there is no working copy", which is a different answer.
    return status !== null && status.workingDirectory.files.length === 0
  }

  public getUpstreamDivergence(branch: Branch): Promise<IAheadBehind | null> {
    if (branch.upstream === null) {
      return Promise.resolve(null)
    }

    return this.getAheadBehind(branch.name, branch.upstream)
  }
}
