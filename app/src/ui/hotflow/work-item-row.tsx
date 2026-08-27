import * as React from 'react'
import { IReconciledWorkItem } from '../../models/hotflow'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { LinkButton } from '../lib/link-button'
import { defaultAdoConfig, getWorkItemUrl } from '../../lib/hotflow/ado-client'
import classNames from 'classnames'

interface IWorkItemRowProps {
  readonly item: IReconciledWorkItem
}

/**
 * One row of the reconciled work item list.
 *
 * State is encoded three ways — glyph, row tint, and a left stripe on the
 * missing rows — so the list survives greyscale printing, projection, and colour
 * blindness rather than relying on tint alone.
 */
export class WorkItemRow extends React.Component<IWorkItemRowProps> {
  public render() {
    const { item } = this.props
    const { workItem, presence } = item

    const className = classNames('hotflow-wi-row', {
      missing: presence === 'missing-from-release',
      untagged: presence === 'in-release-untagged',
    })

    return (
      <tr className={className}>
        <td className="hotflow-wi-glyph">{this.renderGlyph()}</td>
        <td className="hotflow-wi-id">
          <LinkButton
            uri={getWorkItemUrl(defaultAdoConfig, item.id)}
            title={`Open work item ${item.id} in Azure DevOps`}
          >
            {item.id}
          </LinkButton>
        </td>
        <td className="hotflow-wi-type">
          {workItem !== null && (
            <span
              className={classNames(
                'hotflow-wi-type-badge',
                typeClassName(workItem.workItemType)
              )}
            >
              {workItem.workItemType}
            </span>
          )}
        </td>
        <td className="hotflow-wi-title">
          {workItem?.title ?? <span className="dim">Detail unavailable</span>}
        </td>
        <td className="hotflow-wi-state">{this.renderState()}</td>
      </tr>
    )
  }

  private renderGlyph() {
    switch (this.props.item.presence) {
      case 'missing-from-release':
        return (
          <Octicon
            className="warn"
            symbol={octicons.alert}
            title="Assigned to this release but not merged into it"
          />
        )
      case 'shipped-earlier':
        return (
          <Octicon
            className="dim"
            symbol={octicons.checkCircle}
            title="Merged and shipped in an earlier release, though Azure DevOps still has it assigned to this one"
          />
        )
      case 'in-release-untagged':
        return (
          <Octicon
            className="info"
            symbol={octicons.info}
            title="In the release but not assigned to it in Azure DevOps"
          />
        )
      case 'in-release-tagged':
        return (
          <Octicon
            className="ok"
            symbol={octicons.checkCircle}
            title="In the release and assigned to it in Azure DevOps"
          />
        )
      case 'merged':
        // The same tick, without the claim about Azure DevOps. Nothing was
        // compared — either this release has no sequence number or ADO wasn't
        // reachable — so all that can honestly be said is that it's in there.
        return (
          <Octicon
            className="ok"
            symbol={octicons.checkCircle}
            title="Merged into this release"
          />
        )
      default:
        return null
    }
  }

  private renderState() {
    const { item } = this.props

    if (item.presence === 'missing-from-release') {
      return <span className="hotflow-wi-missing">Not in release</span>
    }

    if (item.presence === 'shipped-earlier') {
      /*
       * Shipped, not outstanding.
       *
       * The release contains what is in `production..release`, so anything
       * already shipped is outside it by definition — which is why this used to
       * read as "Not in release", the same words as work nobody has started.
       */
      return <span className="dim">Shipped earlier</span>
    }

    if (item.presence === 'in-release-untagged') {
      return <span className="dim">Unassigned</span>
    }

    if (item.presence === 'merged') {
      // Deliberately not "Unassigned": nobody looked, and that word would read as
      // having looked and found nothing.
      return <span className="dim">{item.workItem?.state ?? 'Merged'}</span>
    }

    return <span className="dim">{item.workItem?.state ?? '—'}</span>
  }
}

/**
 * Maps an Azure DevOps work item type onto a badge style. Bugs read as problems,
 * stories as new work, everything else stays neutral.
 */
function typeClassName(workItemType: string): string {
  const normalized = workItemType.toLowerCase()

  if (normalized.includes('bug') || normalized.includes('defect')) {
    return 'bug'
  }

  if (
    normalized.includes('story') ||
    normalized.includes('feature') ||
    normalized.includes('epic')
  ) {
    return 'story'
  }

  return 'task'
}
