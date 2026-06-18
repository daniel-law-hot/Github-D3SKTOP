import * as React from 'react'

import { Octicon } from '../octicons'
import * as octicons from '../octicons/octicons.generated'
import { Checkbox, CheckboxValue } from '../lib/checkbox'

interface IChangedFolderProps {
  /** The folder's full path from the repo root, e.g. `app/src/ui`. */
  readonly path: string
  /** The folder's display name (last path segment). */
  readonly name: string
  /** Indentation, in pixels, applied to the start of the row. */
  readonly indentation: number
  /** Whether the folder is currently expanded. */
  readonly expanded: boolean
  /**
   * The tri-state include value for the folder, derived from its descendant
   * files: `true` when all are included, `false` when none are, `null` when
   * the folder contains a mix.
   */
  readonly include: boolean | null
  readonly disableSelection: boolean
  readonly onIncludeChanged: (path: string, include: boolean) => void
}

/** A folder row in the changed files tree. */
export class ChangedFolder extends React.Component<IChangedFolderProps, {}> {
  private handleCheckboxChange = (event: React.FormEvent<HTMLInputElement>) => {
    const include = event.currentTarget.checked
    this.props.onIncludeChanged(this.props.path, include)
  }

  private get checkboxValue(): CheckboxValue {
    if (this.props.include === true) {
      return CheckboxValue.On
    } else if (this.props.include === false) {
      return CheckboxValue.Off
    } else {
      return CheckboxValue.Mixed
    }
  }

  public render() {
    const { name, indentation, expanded, disableSelection } = this.props

    return (
      <div className="folder" style={{ marginInlineStart: indentation }}>
        <Checkbox
          tabIndex={-1}
          value={this.checkboxValue}
          onChange={this.handleCheckboxChange}
          disabled={disableSelection}
        />

        <Octicon
          className="folder-chevron"
          symbol={expanded ? octicons.chevronDown : octicons.chevronRight}
        />

        <Octicon className="folder-icon" symbol={octicons.fileDirectoryFill} />

        <span className="folder-name">{name}</span>
      </div>
    )
  }
}
