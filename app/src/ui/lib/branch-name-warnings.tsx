import * as React from 'react'
import { Branch, BranchType } from '../../models/branch'

import { Row } from './row'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Ref } from './ref'

export function renderBranchHasRemoteWarning(branch: Branch) {
  if (branch.upstream != null) {
    return (
      <Row className="warning-helper-text">
        <Octicon symbol={octicons.alert} />
        <p>
          This branch is tracking <Ref>{branch.upstream}</Ref> and renaming this
          branch will not change the branch name on the remote.
        </p>
      </Row>
    )
  } else {
    return null
  }
}

/**
 * Recommended branch naming convention: `feature/{vso number}-{description}`
 * e.g. `feature/12345-fix-login-redirect`.
 *
 * This is only a warning and is not enforced.
 */
const branchNameFormatRegex = /^feature\/\d+-[a-z0-9]+(?:-[a-z0-9]+)*$/

export function renderBranchNameFormatWarning(branchName: string) {
  if (branchName.length === 0 || branchNameFormatRegex.test(branchName)) {
    return null
  }

  return (
    <Row className="warning-helper-text">
      <Octicon symbol={octicons.alert} />
      <p>
        Branch name doesn't match the recommended format.
        <br />
        (e.g. <Ref>feature/12345-fix-login-redirect</Ref>)
      </p>
    </Row>
  )
}

export function renderBranchNameExistsOnRemoteWarning(
  sanitizedName: string,
  branches: ReadonlyArray<Branch>
) {
  const alreadyExistsOnRemote =
    branches.findIndex(
      b => b.nameWithoutRemote === sanitizedName && b.type === BranchType.Remote
    ) > -1

  if (alreadyExistsOnRemote === false) {
    return null
  }

  return (
    <Row className="warning-helper-text">
      <Octicon symbol={octicons.alert} />
      <p>
        A branch named <Ref>{sanitizedName}</Ref> already exists on the remote.
      </p>
    </Row>
  )
}
