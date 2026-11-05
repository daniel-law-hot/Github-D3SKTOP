import * as React from 'react'
import classNames from 'classnames'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { IForgottenState } from '../../models/hotflow'
import { IForgottenBranch } from '../../lib/hotflow/forgotten-branches'
import { Button } from '../lib/button'
import { LinkButton } from '../lib/link-button'
import { RelativeTime } from '../relative-time'
import { shell } from '../../lib/app-shell'
import { TooltippedContent } from '../lib/tooltipped-content'

interface IForgottenBranchesPanelProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly forgotten: IForgottenState
  readonly integrationBranchName: string

  /** Checks a branch out, for the ones with nowhere else to start from. */
  readonly onCheckout: (branchName: string) => void
}

/**
 * Where to start a pull request for a branch, or null when the repository has no
 * web address to start it on.
 */
function compareUrl(
  repository: Repository,
  integration: string,
  branch: string
): string | null {
  const base = repository.gitHubRepository?.htmlURL

  if (base === null || base === undefined) {
    return null
  }

  return (
    `${base}/compare/${encodeURIComponent(integration)}` +
    `...${encodeURIComponent(branch)}?expand=1`
  )
}

interface IForgottenBranchRowProps {
  readonly branch: IForgottenBranch
  readonly repository: Repository
  readonly dispatcher: Dispatcher

  /** Where to start the pull request, or null for a branch only this machine has. */
  readonly compareUrl: string | null
  readonly onCheckout: (branchName: string) => void
}

class ForgottenBranchRow extends React.Component<IForgottenBranchRowProps> {
  private onOpen = () => {
    if (this.props.compareUrl !== null) {
      shell.openExternal(this.props.compareUrl)
    }
  }

  private onHide = () => {
    this.props.dispatcher.hideForgottenBranch(
      this.props.repository,
      this.props.branch.branchName
    )
  }

  private onCheckout = () => {
    this.props.onCheckout(this.props.branch.branchName)
  }

  public render() {
    const { branch, compareUrl: url } = this.props

    return (
      <li className="hotflow-forgotten-item">
        <TooltippedContent
          className="mono hotflow-forgotten-name"
          tooltip={branch.branchName}
        >
          {branch.branchName}
        </TooltippedContent>
        <div className="hotflow-forgotten-meta">
          <span
            className={classNames('hotflow-forgotten-badge', {
              local: branch.isLocalOnly,
            })}
          >
            {branch.isLocalOnly ? 'not pushed' : 'pushed, no PR'}
          </span>
          <span>
            {branch.aheadCount} {branch.aheadCount === 1 ? 'commit' : 'commits'}
          </span>
          <span>
            last commit{' '}
            <RelativeTime
              date={new Date(branch.lastCommitAt)}
              onlyRelative={true}
            />
          </span>
        </div>
        <div className="hotflow-forgotten-actions">
          {url !== null ? (
            <Button onClick={this.onOpen}>Open PR</Button>
          ) : (
            <Button onClick={this.onCheckout}>Check out</Button>
          )}
          <Button onClick={this.onHide}>Hide</Button>
        </div>
      </li>
    )
  }
}

/**
 * The user's own branches that were started and never raised as a pull request:
 * the work most easily lost, since nobody else knows it exists.
 */
export class ForgottenBranchesPanel extends React.Component<IForgottenBranchesPanelProps> {
  private onUnhide = () => {
    this.props.dispatcher.unhideForgottenBranches(this.props.repository)
  }

  public render() {
    const { forgotten } = this.props

    return (
      <div className="hotflow-forgotten">
        <h3 className="hotflow-summary-heading">
          Your branches with no pull request
        </h3>
        {this.renderBody(forgotten)}
        {forgotten.hiddenCount > 0 && (
          <div className="hotflow-summary-empty">
            Hidden ({forgotten.hiddenCount}) ·{' '}
            <LinkButton onClick={this.onUnhide}>Show</LinkButton>
          </div>
        )}
      </div>
    )
  }

  private renderBody(forgotten: IForgottenState) {
    if (forgotten.status === 'error' && forgotten.branches.length === 0) {
      return (
        <div className="hotflow-summary-empty">
          Could not look for your branches: {forgotten.errorMessage}
        </div>
      )
    }

    if (forgotten.branches.length === 0) {
      return (
        <div className="hotflow-summary-empty">
          {forgotten.status === 'ok'
            ? '✓ Nothing forgotten. Every branch of yours has a pull request or is merged.'
            : 'Looking for your branches…'}
        </div>
      )
    }

    return (
      <>
        <div className="hotflow-summary-empty">
          Branches you committed to that nobody has opened a pull request for.
        </div>
        <ul className="hotflow-forgotten-list">
          {forgotten.branches.map(b => this.renderBranch(b))}
        </ul>
      </>
    )
  }

  private renderBranch(branch: IForgottenBranch) {
    const { repository, dispatcher, integrationBranchName } = this.props

    return (
      <ForgottenBranchRow
        key={branch.branchName}
        branch={branch}
        repository={repository}
        dispatcher={dispatcher}
        compareUrl={
          branch.isLocalOnly
            ? null
            : compareUrl(repository, integrationBranchName, branch.branchName)
        }
        onCheckout={this.props.onCheckout}
      />
    )
  }
}
