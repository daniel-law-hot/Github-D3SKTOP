import * as React from 'react'
import { basename } from 'path'

import { AppFileStatus, AppFileStatusKind } from '../../models/status'
import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { PathText } from './path-text'
import { IMatches } from '../../lib/fuzzy-find'

interface IPathLabelProps {
  /** the current path of the file */
  readonly path: string
  /** the type of change applied to the file */
  readonly status: AppFileStatus

  readonly availableWidth?: number

  /** aria hidden value */
  readonly ariaHidden?: boolean

  /** The characters in the file path to highlight */
  readonly matches?: IMatches

  /**
   * Render only the file name rather than the full path. Used by the changed
   * files tree view, where the containing folders are already shown as rows so
   * repeating the directory in each file would be redundant.
   */
  readonly pathAsBaseName?: boolean
}

/** The pixel width reserved to give the resize arrow padding on either side. */
const ResizeArrowPadding = 10

/**
 * Render the path details for a given file.
 *
 * For renames, this will render the old path as well as the current path.
 * For other scenarios, only the current path is rendered.
 *
 */
export class PathLabel extends React.Component<IPathLabelProps, {}> {
  public render() {
    const props: React.HTMLProps<HTMLLabelElement> = {
      className: 'path-label-component',
    }

    const { status, matches, pathAsBaseName } = this.props

    const display = (path: string) => (pathAsBaseName ? basename(path) : path)

    const availableWidth = this.props.availableWidth
    if (
      status.kind === AppFileStatusKind.Renamed ||
      status.kind === AppFileStatusKind.Copied
    ) {
      const segmentWidth = availableWidth
        ? availableWidth / 2 - ResizeArrowPadding
        : undefined
      return (
        <span {...props} aria-hidden={this.props.ariaHidden}>
          <PathText
            path={display(status.oldPath)}
            availableWidth={segmentWidth}
          />
          <Octicon className="rename-arrow" symbol={octicons.arrowRight} />
          <PathText
            path={display(this.props.path)}
            availableWidth={segmentWidth}
            matches={matches}
          />
        </span>
      )
    } else {
      return (
        <span {...props} aria-hidden={this.props.ariaHidden}>
          <PathText
            path={display(this.props.path)}
            matches={matches}
            availableWidth={availableWidth}
          />
        </span>
      )
    }
  }
}
