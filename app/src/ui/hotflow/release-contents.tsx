import * as React from 'react'
import { Commit } from '../../models/commit'
import {
  IAdoState,
  IReconciliation,
  IReleaseBranchState,
  IShippedRelease,
} from '../../models/hotflow'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Button } from '../lib/button'
import { WorkItemRow } from './work-item-row'
import { RelativeTime } from '../relative-time'
import classNames from 'classnames'

export type ReleaseContentsTab =
  /** The working directory: file list, diff and commit form. Feature branches only. */
  'branch-changes' | 'work-items' | 'commits' | 'drift'

interface IReleaseContentsProps {
  readonly release: IReleaseBranchState
  readonly reconciliation: IReconciliation
  readonly ado: IAdoState
  readonly selectedTab: ReleaseContentsTab
  readonly onTabChanged: (tab: ReleaseContentsTab) => void
  readonly onConnectAdo: () => void

  /** The resolved integration branch name, for copy. */
  readonly integrationBranchName: string

  /**
   * A shipped release to show instead of the current one, or null for normal.
   *
   * Its contents come from git — the commits between the tag below it and it — so
   * this is a historical record rather than a reconciliation. Nothing is
   * outstanding in a release that already shipped.
   */
  readonly historyRelease: IShippedRelease | null

  readonly onCloseHistory: () => void

  /**
   * The working directory pane, or null when there's no feature branch to show one
   * for. Built by the view because it needs application state this panel otherwise
   * has no business knowing about.
   */
  readonly branchChanges: JSX.Element | null

  /** Count for the Branch changes tab. */
  readonly changedFileCount: number

  /**
   * True while the release is being re-read from git.
   *
   * Everything in this panel describes one release, so during a switch it all
   * describes the wrong one. Showing the previous release's work items under the new
   * release's name for a second and a half reads as fact, not as staleness.
   */
  readonly isLoading: boolean
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
    const { release, reconciliation, selectedTab, historyRelease } = this.props

    // A shipped release has no drift — it was merged and tagged, so there's
    // nothing for it to be behind. Its work item list is also just its contents,
    // with nothing outstanding to warn about.
    const tabs: ReadonlyArray<{
      readonly id: ReleaseContentsTab
      readonly label: string
      readonly count: number
      readonly warn?: boolean
    }> =
      historyRelease !== null
        ? [
            {
              id: 'work-items',
              label: 'Work items',
              count: historyRelease.vsoNumbers?.length ?? 0,
            },
            {
              id: 'commits',
              label: 'Commits',
              count: historyRelease.commits?.length ?? 0,
            },
          ]
        : [
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
            // Last, and only when there's a feature branch to show changes for —
            // on a release branch the working directory isn't what you came here
            // for. The three before it describe the release, which is what this
            // view is about; this one describes your working copy.
            ...(this.props.branchChanges !== null
              ? [
                  {
                    id: 'branch-changes' as const,
                    label: 'Branch changes',
                    count: this.props.changedFileCount,
                  },
                ]
              : []),
          ]

    return (
      <div className="hotflow-tabs">
        <div className="hotflow-tab-strip" role="tablist">
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
              {/* The counts belong to the release being replaced, so they go
                  quiet rather than asserting the old numbers under the new name. */}
              {!this.props.isLoading && (
                <span
                  className={classNames('hotflow-tab-count', {
                    warn: tab.warn,
                  })}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {historyRelease !== null && (
          <div className="hotflow-history-banner">
            <Octicon className="dim" symbol={octicons.tag} />
            <span className="mono">{historyRelease.tagName}</span>
            <span className="dim">shipped</span>
            <Button
              className="hotflow-icon-button"
              onClick={this.props.onCloseHistory}
              ariaLabel={`Stop showing ${historyRelease.tagName} and return to the current release`}
            >
              <Octicon symbol={octicons.x} />
            </Button>
          </div>
        )}
      </div>
    )
  }

  private onTabClick = (tab: ReleaseContentsTab) => () => {
    this.props.onTabChanged(tab)
  }

  /**
   * The banner above the list, which now says one thing only: whether Azure DevOps
   * answered at all.
   *
   * It used to also report on the reconciliation, which was a mistake twice over —
   * see the note where those returned null.
   */
  private renderBanner() {
    const { ado, selectedTab, historyRelease } = this.props

    if (selectedTab !== 'work-items') {
      return null
    }

    // Every banner below is a statement about the *current* release. None of them
    // are true of a release that shipped months ago, and showing them under a
    // history header attributes the current release's state to the wrong release.
    if (historyRelease !== null) {
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

    // Nothing left to say. Both banners that used to live here are gone: the
    // unmatched sequence number is marked on the number itself in the properties
    // pane, and the all-clear counted only the work items assigned to the release
    // while the list beside it showed everything in the release — three next to ten
    // rows, which read as a wrong number rather than as good news.
    return null
  }

  private renderTabContent() {
    const { historyRelease, selectedTab } = this.props

    // Cleared rather than left stale. A switch takes a second or two, and for that
    // whole time the list underneath belongs to the release you just left.
    if (this.props.isLoading) {
      return (
        <div className="hotflow-loading">
          <Octicon symbol={octicons.sync} className="spin" />
          <span>Reading the release…</span>
        </div>
      )
    }

    // A shipped release only ever has contents, so both its tabs read from it and
    // 'drift' — which it can't have — falls back to its work items rather than
    // rendering the current release's drift under a history header.
    if (historyRelease !== null) {
      // Opened before its commits arrived. The row's spinner says why; this says it
      // again where the content would be, rather than showing an empty release.
      if (historyRelease.commits === null) {
        return (
          <div className="hotflow-loading">
            <Octicon symbol={octicons.sync} className="spin" />
            <span>{`Reading what ${historyRelease.tagName} shipped…`}</span>
          </div>
        )
      }

      return selectedTab === 'commits'
        ? this.renderCommits(historyRelease.commits, 'commits')
        : this.renderHistoryWorkItems(historyRelease)
    }

    switch (selectedTab) {
      case 'branch-changes':
        // Null when the tab isn't offered — a stale selection from before a
        // checkout, which falls back rather than rendering an empty panel.
        return this.props.branchChanges ?? this.renderWorkItems()
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

  /**
   * The work items a shipped release carried.
   *
   * Deliberately not a reconciliation: there's nothing to reconcile against once a
   * release has shipped, and "assigned but not merged" is meaningless in the past
   * tense. Every row is simply something that went out, so they all share one
   * presence and the legend is dropped.
   */
  private renderHistoryWorkItems(historyRelease: IShippedRelease) {
    const { ado } = this.props

    // Only reached once the contents are read — the caller shows a spinner until
    // then — so these are known to be present.
    const vsoNumbers = historyRelease.vsoNumbers ?? []
    const commitCount = historyRelease.commits?.length ?? 0

    if (vsoNumbers.length === 0) {
      return (
        <div className="hotflow-empty-list">
          No VSO numbers found in the {commitCount} commits{' '}
          {historyRelease.tagName} shipped. HotFlow reads them from branch names
          and commit messages, so a release merged without them reads as empty
          here.
        </div>
      )
    }

    return (
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
            {vsoNumbers.map(id => (
              <WorkItemRow
                key={id}
                item={{
                  id,
                  // A shipped release is never reconciled — the refresh only asks
                  // Azure DevOps about the current one — so these were merged and
                  // nothing more is known about them.
                  presence: 'merged',
                  workItem: ado.workItems.get(id) ?? null,
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    )
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
