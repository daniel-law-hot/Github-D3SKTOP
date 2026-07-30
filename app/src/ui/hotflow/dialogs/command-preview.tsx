import * as React from 'react'
import { LinkButton } from '../../lib/link-button'
import { clipboard } from 'electron'

interface ICommandPreviewProps {
  readonly commands: ReadonlyArray<string>
}

interface ICommandPreviewState {
  readonly copied: boolean
}

/**
 * The collapsible "show exact git commands" block, with a copy escape hatch.
 *
 * The escape hatch matters: someone who'd rather not let a GUI merge into `main`
 * can take the commands and run them themselves. Trust comes from showing the
 * work, and from not forcing the tool on anyone.
 */
export class CommandPreview extends React.Component<
  ICommandPreviewProps,
  ICommandPreviewState
> {
  public constructor(props: ICommandPreviewProps) {
    super(props)
    this.state = { copied: false }
  }

  public render() {
    return (
      <details className="hotflow-commands">
        <summary>Show exact git commands</summary>
        <pre className="hotflow-command-block">
          {this.props.commands.join('\n')}
        </pre>
        <div className="hotflow-command-actions">
          <LinkButton onClick={this.onCopy}>
            {this.state.copied ? 'Copied' : 'Copy commands instead'}
          </LinkButton>
        </div>
      </details>
    )
  }

  private onCopy = () => {
    clipboard.writeText(this.props.commands.join('\n'))
    this.setState({ copied: true })
  }
}
