import * as React from 'react'
import { Repository } from '../../../models/repository'
import { Dispatcher } from '../../dispatcher'
import { Dialog, DialogContent, DialogError, DialogFooter } from '../../dialog'
import { OkCancelButtonGroup } from '../../dialog/ok-cancel-button-group'
import { TextBox } from '../../lib/text-box'
import { LinkButton } from '../../lib/link-button'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import {
  defaultAdoConfig,
  testAdoConnection,
} from '../../../lib/hotflow/ado-client'

interface IConnectAdoDialogProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly onDismissed: () => void
}

interface IConnectAdoDialogState {
  readonly pat: string
  readonly isTesting: boolean
  readonly testResult: 'untested' | 'ok' | 'failed'
  readonly errorMessage: string | null
  readonly isSaving: boolean
}

/** Where to mint a token, with the scope HotFlow needs pre-selected. */
const TokenCreationUrl =
  'https://dev.azure.com/houseoftravel/_usersSettings/tokens'

/**
 * Connect to Azure DevOps with a personal access token.
 *
 * Only reached when the Azure CLI isn't available — HotFlow tries `az` first and
 * says nothing if it works.
 *
 * Read & write, because HotFlow now sets the Release sequence number rather than
 * only reading it. A read-only token still gets the whole release picture and
 * every reconciliation — it just cannot fill the field in, which fails at the
 * point of trying rather than at the point of connecting. Saying so here is what
 * stops that being a surprise.
 */
export class ConnectAdoDialog extends React.Component<
  IConnectAdoDialogProps,
  IConnectAdoDialogState
> {
  public constructor(props: IConnectAdoDialogProps) {
    super(props)
    this.state = {
      pat: '',
      isTesting: false,
      testResult: 'untested',
      errorMessage: null,
      isSaving: false,
    }
  }

  public render() {
    const canSubmit =
      this.state.pat.trim().length > 0 &&
      !this.state.isTesting &&
      !this.state.isSaving

    return (
      <Dialog
        id="hotflow-connect-ado"
        title={
          __DARWIN__ ? 'Connect to Azure DevOps' : 'Connect to Azure DevOps'
        }
        onSubmit={this.onSubmit}
        onDismissed={this.props.onDismissed}
        loading={this.state.isSaving}
      >
        {this.state.errorMessage !== null && (
          <DialogError>{this.state.errorMessage}</DialogError>
        )}

        <DialogContent>
          <p className="hotflow-dialog-lede">
            HotFlow reads work item titles and cycle tags so it can tell you
            what's in a release — and what's tagged for the cycle but hasn't
            been merged yet.
          </p>

          <div className="hotflow-dl">
            <span className="dim">Organisation</span>
            <span className="mono">{defaultAdoConfig.organisation}</span>
            <span className="dim">Project</span>
            <span className="mono">{defaultAdoConfig.project}</span>
          </div>

          <TextBox
            label="Personal access token"
            value={this.state.pat}
            onValueChanged={this.onPatChanged}
            type="password"
            autoFocus={true}
          />

          <p className="hotflow-dialog-note">
            Needs <strong>Work Items (Read &amp; write)</strong> — read for the
            reconciliation, write to set a release sequence number.{' '}
            <LinkButton uri={TokenCreationUrl}>Create a token</LinkButton>. It's
            stored in your operating system's credential vault, never on disk.
          </p>

          {this.renderTestResult()}
        </DialogContent>

        <DialogFooter>
          <OkCancelButtonGroup
            okButtonText="Connect"
            okButtonDisabled={!canSubmit}
          />
        </DialogFooter>
      </Dialog>
    )
  }

  private renderTestResult() {
    if (this.state.isTesting) {
      return (
        <div className="hotflow-preflight-loading">
          <Octicon symbol={octicons.sync} className="spin" /> Testing…
        </div>
      )
    }

    if (this.state.testResult === 'ok') {
      return (
        <div className="hotflow-test-result ok">
          <Octicon symbol={octicons.checkCircle} /> Connected successfully.
        </div>
      )
    }

    return (
      <div className="hotflow-test-actions">
        <LinkButton
          onClick={this.onTest}
          disabled={this.state.pat.trim().length === 0}
        >
          Test connection
        </LinkButton>
      </div>
    )
  }

  private onPatChanged = (pat: string) => {
    this.setState({ pat, testResult: 'untested', errorMessage: null })
  }

  private onTest = async () => {
    this.setState({ isTesting: true, errorMessage: null })

    try {
      await testAdoConnection(defaultAdoConfig, {
        kind: 'pat',
        token: this.state.pat.trim(),
      })
      this.setState({ isTesting: false, testResult: 'ok' })
    } catch (e) {
      this.setState({
        isTesting: false,
        testResult: 'failed',
        errorMessage:
          e instanceof Error
            ? e.message
            : 'Could not reach Azure DevOps with that token.',
      })
    }
  }

  private onSubmit = async () => {
    this.setState({ isSaving: true, errorMessage: null })

    try {
      await this.props.dispatcher.setAdoPat(
        this.props.repository,
        this.state.pat.trim()
      )
      this.props.onDismissed()
    } catch (e) {
      this.setState({
        isSaving: false,
        errorMessage:
          e instanceof Error ? e.message : 'Could not save the token.',
      })
    }
  }
}
