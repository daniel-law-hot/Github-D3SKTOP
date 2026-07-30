import * as React from 'react'
import { Commit } from '../../models/commit'
import {
  IAdoState,
  IReconciliation,
  IReleaseBranchState,
} from '../../models/hotflow'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { WorkItemRow } from './work-item-row'
import { RelativeTime } from '../relative-time'
import classNames from 'classnames'

export type ReleaseContentsTab = 'work-items' | 'commits' | 'drift'

interface IReleaseContentsProps {
  readonly release: IReleaseBranchState
  readonly reconciliation: IReconciliation
  readonly ado: IAdoState
  readonly selectedTab: ReleaseContentsTab
  readonly onTabChanged: (tab: ReleaseContentsTab) => void
  readonly onConnectAdo: () => void
  readonly onConfirmCycle: () => void

  /** The resolved integration branch name, for copy. */
  readonly integrationBranchName: string
}

/**
 * The left panel: what's actually in this release, across three views.
 *
 * Work items is the default because it answers the question people open HotFlow
 * to ask. Commits and drift are the supporting detail.
 */
export class ReleaseContents extends React.Component<IReleaseContentsProps> {
  public render() {
    return (
      <div className="hotflow-contents">
        {this.renderTabs()}
        {this.renderBanner()}
        {this.renderTabContent()}
      </div>
    )
  }

  private renderTabs() {
    const { release, reconciliation, selectedTab } = this.props

    const tabs: ReadonlyArray<{
      readonly id: ReleaseContentsTab
      readonly label: string
      readonly count: number
      readonly warn?: boolean
    }> = [
      {
        id: 'work-items',
        label: 'Work items',
        count: reconciliation.items.length,
        warn: reconciliation.missingCount > 0,
      },
      { id: 'commits', label: 'Commits', count: release.commits.length },
      {
        id: 'drift',
        label: 'Drift',
        count: release.behindIntegration,
        warn: release.behindIntegration > 0,
      },
    ]

    return (
      <div className="hotflow-tabs" role="tablist">
        {tabs.map(tab => (
          <button
            key={tab.id}
            role="tab"
            type="button"
            aria-selected={selectedTab === tab.id}
            className={classNames('hotflow-tab', {
              selected: selectedTab === tab.id,
            })}
            onClick={this.onTabClick(tab.id)}
          >
            {tab.label}
            <span
              className={classNames('hotflow-tab-count', { warn: tab.warn })}
            >
              {tab.count}
            </span>
          </button>
        ))}
      </div>
    )
  }

  private onTabClick = (tab: ReleaseContentsTab) => () => {
    this.props.onTabChanged(tab)
  }

  /**
   * The banner above the list, which is where HotFlow is honest about how much it
   * actually knows: whether Azure DevOps answered, and whether the cycle backing
   * the reconciliation has been confirmed.
   */
  private renderBanner() {
    const { ado, reconciliation, selectedTab } = this.props

    if (selectedTab !== 'work-items') {
      return null
    }

    if (ado.status === 'unconfigured') {
      return (
        <div className="hotflow-banner info">
          <Octicon symbol={octicons.info} />
          <span>
            Work item detail is unavailable. Connect to Azure DevOps to see
            titles, states, and anything assigned to this release that hasn't
            been merged yet.
          </span>
          <Button onClick={this.props.onConnectAdo}>
            Connect to Azure DevOps
          </Button>
        </div>
      )
    }

    if (ado.status === 'error') {
      return (
        <div className="hotflow-banner error">
          <Octicon symbol={octicons.alert} />
          <span>
            Couldn't reach Azure DevOps
            {ado.errorMessage !== null ? `: ${ado.errorMessage}` : '.'} Showing
            work items found in git only.
          </span>
          <Button onClick={this.props.onConnectAdo}>Reconnect</Button>
        </div>
      )
    }

    if (ado.status === 'loading') {
      return (
        <div className="hotflow-banner info">
          <Octicon symbol={octicons.sync} className="spin" />
          <span>Loading work items from Azure DevOps…</span>
        </div>
      )
    }

    if (reconciliation.provisional) {
      return (
        <div className="hotflow-banner warn">
          <Octicon symbol={octicons.alert} />
          <span>
            <strong>Provisional.</strong> The cycle was guessed from the version
            number, so this list may be incomplete. Confirm the cycle to be
            sure.
          </span>
          <Button onClick={this.props.onConfirmCycle}>Confirm cycle</Button>
        </div>
      )
    }

    if (reconciliation.missingCount === 0 && reconciliation.items.length > 0) {
      return (
        <div className="hotflow-banner ok">
          <Octicon symbol={octicons.checkCircle} />
          <span>
            All {reconciliation.inReleaseTaggedCount} work items assigned to
            this release are in it. Nothing outstanding.
          </span>
        </div>
      )
    }

    return null
  }

  private renderTabContent() {
    switch (this.props.selectedTab) {
      case 'work-items':
        return this.renderWorkItems()
      case 'commits':
        return this.renderCommits(this.props.release.commits, 'commits')
      case 'drift':
        return this.renderDrift()
      default:
        return null
    }
  }

  private renderWorkItems() {
    const { reconciliation } = this.props

    if (reconciliation.items.length === 0) {
      return (
        <div className="hotflow-empty-list">
          No work items found in this release. HotFlow reads VSO numbers from
          feature branch names and commit messages — if this looks wrong, the
          commits may not reference their work items.
        </div>
      )
    }

    return (
      <>
        <div className="hotflow-table-scroll">
          <table className="hotflow-table">
            <thead>
              <tr>
                <th className="hotflow-wi-glyph">
                  <span className="sr-only">Status</span>
                </th>
                <th className="hotflow-wi-id">VSO</th>
                <th className="hotflow-wi-type">Type</th>
                <th>Title</th>
                <th className="hotflow-wi-state">State</th>
              </tr>
            </thead>
            <tbody>
              {reconciliation.items.map(item => (
                <WorkItemRow key={item.id} item={item} />
              ))}
            </tbody>
          </table>
        </div>
        {this.renderLegend()}
      </>
    )
  }

  private renderLegend() {
    return (
      <div className="hotflow-legend">
        <span>
          <Octicon className="ok" symbol={octicons.checkCircle} /> In release
          and assigned to it
        </span>
        <span>
          <Octicon className="warn" symbol={octicons.alert} /> Assigned but not
          merged
        </span>
        <span>
          <Octicon className="info" symbol={octicons.info} /> In release, not
          assigned
        </span>
      </div>
    )
  }

  private renderDrift() {
    const { release } = this.props

    if (release.behindIntegration === 0) {
      return (
        <div className="hotflow-empty-list">
          This release is up to date with {this.props.integrationBranchName}.
          Nothing to pull in.
        </div>
      )
    }

    return this.renderCommits(release.incomingCommits, 'drift')
  }

  private renderCommits(
    commits: ReadonlyArray<Commit>,
    context: 'commits' | 'drift'
  ) {
    if (commits.length === 0) {
      return (
        <div className="hotflow-empty-list">
          {context === 'drift'
            ? `Nothing waiting in ${this.props.integrationBranchName}.`
            : 'No commits in this release.'}
        </div>
      )
    }

    return (
      <div className="hotflow-table-scroll">
        <table className="hotflow-table hotflow-commits">
          <thead>
            <tr>
              <th className="hotflow-sha">Commit</th>
              <th>Summary</th>
              <th className="hotflow-commit-author">Author</th>
              <th className="hotflow-commit-date">When</th>
            </tr>
          </thead>
          <tbody>
            {commits.map(commit => (
              <tr key={commit.sha}>
                <td className="hotflow-sha">{commit.shortSha}</td>
                {/* Truncation is visual only — the full summary stays in the
                    DOM so screen readers and copy still get all of it. */}
                <td className="hotflow-commit-summary">{commit.summary}</td>
                <td className="hotflow-commit-author">{commit.author.name}</td>
                <td className="hotflow-commit-date">
                  <RelativeTime date={commit.author.date} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }
}
