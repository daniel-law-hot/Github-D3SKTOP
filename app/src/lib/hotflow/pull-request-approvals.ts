import { API, IAPIPullRequestReview } from '../api'
import { Account } from '../../models/account'
import { GitHubRepository } from '../../models/github-repository'
import { IPullRequestApproval } from '../../models/hotflow'

/**
 * Approval state for pull requests, for HotFlow's merge affordance.
 *
 * Desktop fetches pull requests but not their reviews, so this is a separate
 * read. Kept in HotFlow's own state rather than added to Desktop's pull request
 * database, which has no notion of reviews.
 */

/**
 * Counts approvals the way GitHub does: the *latest* review per reviewer wins,
 * and only `APPROVED` counts.
 *
 * A reviewer who approves, requests changes, then approves again is one
 * approval, not two — and a dismissed approval is not an approval at all. Naively
 * counting `APPROVED` rows overstates both.
 *
 * `COMMENTED` and `PENDING` reviews don't change a reviewer's standing, so they're
 * ignored rather than treated as the reviewer's latest word.
 */
export function countApprovals(
  reviews: ReadonlyArray<IAPIPullRequestReview>
): IPullRequestApproval {
  /** Reviewer login -> their latest decisive review. */
  const latest = new Map<string, IAPIPullRequestReview>()

  for (const review of reviews) {
    // Only these states represent a decision; the others leave it unchanged.
    if (
      review.state !== 'APPROVED' &&
      review.state !== 'CHANGES_REQUESTED' &&
      review.state !== 'DISMISSED'
    ) {
      continue
    }

    const login = review.user?.login

    if (login === undefined) {
      continue
    }

    const existing = latest.get(login)

    if (
      existing === undefined ||
      isAfter(review.submitted_at, existing.submitted_at)
    ) {
      latest.set(login, review)
    }
  }

  let approvals = 0
  let changesRequested = 0

  for (const review of latest.values()) {
    if (review.state === 'APPROVED') {
      approvals++
    } else if (review.state === 'CHANGES_REQUESTED') {
      changesRequested++
    }
    // A DISMISSED review counts as neither.
  }

  return { approvals, changesRequested }
}

/** True when `a` was submitted after `b`, tolerating unparseable dates. */
function isAfter(a: string, b: string): boolean {
  const aTime = Date.parse(a)
  const bTime = Date.parse(b)

  if (isNaN(aTime) || isNaN(bTime)) {
    return false
  }

  return aTime > bTime
}

/**
 * Fetches approval state for the given pull requests, keyed by number.
 *
 * One request per pull request, so callers should only ask about the ones they
 * are going to show. Individual failures are dropped rather than failing the
 * batch — a missing entry renders as "unknown", which is honest.
 */
export async function fetchPullRequestApprovals(
  account: Account,
  gitHubRepository: GitHubRepository,
  pullRequestNumbers: ReadonlyArray<number>
): Promise<ReadonlyMap<number, IPullRequestApproval>> {
  const result = new Map<number, IPullRequestApproval>()

  if (pullRequestNumbers.length === 0) {
    return result
  }

  const api = API.fromAccount(account)
  const owner = gitHubRepository.owner.login
  const name = gitHubRepository.name

  const settled = await Promise.all(
    pullRequestNumbers.map(async prNumber => {
      try {
        const reviews = await api.fetchPullRequestReviews(
          owner,
          name,
          prNumber.toString()
        )

        return { prNumber, approval: countApprovals(reviews) }
      } catch (e) {
        log.debug(`[HotFlow] could not fetch reviews for #${prNumber}`, e)
        return null
      }
    })
  )

  for (const entry of settled) {
    if (entry !== null) {
      result.set(entry.prNumber, entry.approval)
    }
  }

  return result
}
