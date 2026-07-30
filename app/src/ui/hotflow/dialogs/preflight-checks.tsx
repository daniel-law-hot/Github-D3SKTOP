import * as React from 'react'
import { IPreflightCheck } from '../../../lib/hotflow/actions'
import { Octicon } from '../../octicons'
import * as octicons from '../../octicons/octicons.generated'
import classNames from 'classnames'

interface IPreflightChecksProps {
  readonly checks: ReadonlyArray<IPreflightCheck>
  readonly isLoading: boolean
}

/**
 * The pre-flight checklist shown in every HotFlow action dialog.
 *
 * Each check states what was verified and, when it didn't pass, why. Showing the
 * whole list — including the passes — is the point: it's what makes "this is
 * safe" legible rather than asserted.
 */
export class PreflightChecks extends React.Component<IPreflightChecksProps> {
  public render() {
    if (this.props.isLoading) {
      return (
        <div className="hotflow-preflight-loading">
          <Octicon symbol={octicons.sync} className="spin" /> Checking…
        </div>
      )
    }

    if (this.props.checks.length === 0) {
      return null
    }

    return (
      <ul className="hotflow-preflight">
        {this.props.checks.map(check => (
          <li
            key={check.id}
            className={classNames('hotflow-check', check.status)}
          >
            <Octicon symbol={this.getSymbol(check)} />
            <span className="hotflow-check-body">
              <span className="hotflow-check-label">{check.label}</span>
              {check.detail !== undefined && (
                <span className="hotflow-check-detail">{check.detail}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    )
  }

  private getSymbol(check: IPreflightCheck) {
    switch (check.status) {
      case 'pass':
        return octicons.checkCircle
      case 'warn':
        return octicons.alert
      case 'fail':
        return octicons.xCircle
      default:
        return octicons.info
    }
  }
}
