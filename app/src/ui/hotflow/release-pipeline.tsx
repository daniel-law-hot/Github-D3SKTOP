import * as React from 'react'
import classNames from 'classnames'
import { Repository } from '../../models/repository'
import { Dispatcher } from '../dispatcher'
import { IPipelineViewState } from '../../models/hotflow'
import {
  IPipelineRelease,
  IPipelineStage,
  IRepositoryPipeline,
  StageBucket,
  stageTone,
} from '../../lib/hotflow/ado-pipelines'
import { Button } from '../lib/button'
import { RelativeTime } from '../relative-time'
import { TooltippedContent } from '../lib/tooltipped-content'
import { LinkButton } from '../lib/link-button'
import { PopupType } from '../../models/popup'

interface IReleasePipelineProps {
  readonly repository: Repository
  readonly dispatcher: Dispatcher
  readonly pipeline: IPipelineViewState

  /**
   * How many earlier releases to show under each pipeline's current one. Chosen by
   * the divider, a whole number at a time, so the area is always exactly as tall
   * as what is in it.
   */
  readonly earlierCount: number
}

interface IReleasePipelineState {
  /** The approval whose confirm panel is open. */
  readonly confirming: number | null
  readonly comment: string
}

const DefaultComment = 'Approved from HotFlow'

const Buckets: ReadonlyArray<StageBucket> = ['dev', 'uat', 'prod']

const ToneGlyph = {
  ok: '✓',
  run: '◔',
  wait: '⏸',
  bad: '✕',
  idle: '–',
} as const

function stageOf(
  release: IPipelineRelease,
  bucket: StageBucket
): IPipelineStage | undefined {
  return release.stages.find(s => s.bucket === bucket)
}

function bucketName(bucket: StageBucket | null, fallback: string): string {
  return bucket === null ? fallback : bucket.toUpperCase()
}

/**
 * The most earlier releases any pipeline has to show: one fewer than its distinct
 * versions, since the newest is the current one. The divider never goes past this,
 * so there is no room opened up with nothing to put in it. Exported for tests.
 */
export function maxEarlierReleases(
  pipelines: ReadonlyArray<IRepositoryPipeline>
): number {
  return pipelines.reduce(
    (most, p) => Math.max(most, distinctReleases(p.releases).length - 1),
    0
  )
}

function releaseLabel(release: IPipelineRelease): string {
  return release.version ?? release.name
}

/**
 * One release per version, newest first.
 *
 * Azure DevOps makes a new release for every attempt, so a version that was
 * redeployed three times is four rows with the same name. What matters is where
 * the version got to, which is the latest attempt. Exported for tests.
 */
export function distinctReleases(
  releases: ReadonlyArray<IPipelineRelease>
): ReadonlyArray<IPipelineRelease> {
  const seen = new Set<string>()

  return releases.filter(release => {
    const label = releaseLabel(release)

    if (seen.has(label)) {
      return false
    }

    seen.add(label)
    return true
  })
}

/**
 * Where the repository's releases have got to: the newest in full, with DEV, UAT
 * and PROD and when each landed, and the ones before it as a bar of three.
 *
 * A stage waiting on an approval is a button. Pressing it opens a panel naming
 * the release and the stage, and approving is a second, deliberate press — it is
 * a write that moves a deployment.
 */
export class ReleasePipeline extends React.Component<
  IReleasePipelineProps,
  IReleasePipelineState
> {
  public constructor(props: IReleasePipelineProps) {
    super(props)
    this.state = { confirming: null, comment: DefaultComment }
  }

  private onEditPipelines = () => {
    this.props.dispatcher.showPopup({
      type: PopupType.HotFlowEditPipelines,
      repository: this.props.repository,
    })
  }

  private onOpenConfirm = (approvalId: number) => () => {
    this.props.dispatcher.dismissHotFlowApproval(this.props.repository)
    this.setState({ confirming: approvalId, comment: DefaultComment })
  }

  private onCancel = () => {
    this.props.dispatcher.dismissHotFlowApproval(this.props.repository)
    this.setState({ confirming: null })
  }

  private onCommentChanged = (event: React.FormEvent<HTMLTextAreaElement>) => {
    this.setState({ comment: event.currentTarget.value })
  }

  private onApprove = () => {
    const { confirming, comment } = this.state

    if (confirming === null) {
      return
    }

    this.props.dispatcher.approveHotFlowStage(
      this.props.repository,
      confirming,
      comment.trim().length > 0 ? comment.trim() : DefaultComment
    )
  }

  public render() {
    const { pipeline } = this.props

    return (
      <section className="hotflow-pl" aria-label="Release pipeline">
        <h3 className="hotflow-summary-heading">
          Release pipeline
          <LinkButton
            className="hotflow-summary-heading-action"
            onClick={this.onEditPipelines}
          >
            {pipeline.pipelines.length === 0 ? 'Add' : 'Edit'}
          </LinkButton>
        </h3>
        {pipeline.pipelines.length === 0
          ? this.renderEmpty()
          : pipeline.pipelines.map(p => this.renderPipeline(p))}
      </section>
    )
  }

  private renderEmpty() {
    const { pipeline } = this.props

    if (pipeline.status === 'error') {
      return (
        <div className="hotflow-summary-empty">
          Could not read the releases: {pipeline.errorMessage}
        </div>
      )
    }

    if (pipeline.status === 'unavailable') {
      return (
        <div className="hotflow-summary-empty">
          No release pipeline found for this repository. If it has one, add it
          with its address from Azure DevOps.
        </div>
      )
    }

    return <div className="hotflow-summary-empty">Reading releases…</div>
  }

  private renderPipeline(pipeline: IRepositoryPipeline) {
    const [latest, ...older] = distinctReleases(pipeline.releases)

    if (latest === undefined) {
      return null
    }

    const earlier = older.slice(0, this.props.earlierCount)

    return (
      <div key={pipeline.definitionId} className="hotflow-pl-block">
        {this.renderLatest(pipeline, latest)}
        {earlier.length > 0 && this.renderEarlier(earlier)}
      </div>
    )
  }

  private renderLatest(
    pipeline: IRepositoryPipeline,
    release: IPipelineRelease
  ) {
    const stages = Buckets.map(b => stageOf(release, b)).filter(
      (s): s is IPipelineStage => s !== undefined
    )

    const open = stages.find(
      s => s.approval !== null && s.approval.id === this.state.confirming
    )

    return (
      <div className="hotflow-pl-latest">
        <div className="hotflow-pl-latest-head">
          <TooltippedContent
            className="hotflow-pl-name"
            tooltip={pipeline.name}
          >
            {pipeline.name}
          </TooltippedContent>
          <span className="mono hotflow-pl-version">
            {releaseLabel(release)}
          </span>
        </div>
        <div className="hotflow-pl-stages">
          {stages.map(s => this.renderStage(s))}
        </div>
        {open !== undefined && this.renderConfirm(pipeline, release, open)}
      </div>
    )
  }

  private renderStage(stage: IPipelineStage) {
    const tone = stageTone(stage)
    const name = bucketName(stage.bucket, stage.name)

    const body = (
      <>
        <span className="hotflow-pl-stage-name">
          <span aria-hidden={true}>{ToneGlyph[tone.tone]}</span> {name}
        </span>
        <span className="hotflow-pl-stage-note">
          {tone.tone === 'ok' && stage.completedOn !== null ? (
            <RelativeTime
              date={new Date(stage.completedOn)}
              onlyRelative={true}
            />
          ) : (
            tone.label
          )}
        </span>
      </>
    )

    const className = classNames('hotflow-pl-stage', `tone-${tone.tone}`)

    if (tone.tone === 'wait' && stage.approval !== null) {
      return (
        <button
          key={stage.name}
          type="button"
          className={`${className} clickable`}
          aria-expanded={this.state.confirming === stage.approval.id}
          onClick={this.onOpenConfirm(stage.approval.id)}
        >
          {body}
        </button>
      )
    }

    return (
      <span key={stage.name} className={className}>
        {body}
      </span>
    )
  }

  private renderConfirm(
    pipeline: IRepositoryPipeline,
    release: IPipelineRelease,
    stage: IPipelineStage
  ) {
    const approval = stage.approval
    const { approval: attempt } = this.props.pipeline

    if (approval === null) {
      return null
    }

    const name = bucketName(stage.bucket, stage.name)
    const isRunning =
      attempt?.isRunning === true && attempt.approvalId === approval.id
    const error =
      attempt !== null && attempt.approvalId === approval.id
        ? attempt.errorMessage
        : null
    const when =
      approval.type === 'postDeploy' ? 'post-deployment' : 'pre-deployment'

    return (
      <div
        className={classNames('hotflow-pl-confirm', { error: error !== null })}
        role="dialog"
        aria-label={`Approve ${name} ${when}`}
      >
        <strong>
          Approve {name} {when}
        </strong>
        <span>
          {pipeline.name} {releaseLabel(release)}{' '}
          {approval.type === 'postDeploy'
            ? `is deployed to ${name} and waiting for sign-off before the next stage.`
            : `is waiting for approval before it deploys to ${name}.`}
        </span>

        {error !== null && (
          <span className="hotflow-pl-error" role="alert">
            Azure DevOps refused: {error}
          </span>
        )}

        <label htmlFor="hotflow-pl-comment">Comment</label>
        <textarea
          id="hotflow-pl-comment"
          value={this.state.comment}
          onChange={this.onCommentChanged}
          disabled={isRunning}
          rows={2}
        />
        <div className="hotflow-pl-confirm-actions">
          <Button onClick={this.onCancel} disabled={isRunning}>
            Cancel
          </Button>
          <Button type="submit" onClick={this.onApprove} disabled={isRunning}>
            {isRunning ? 'Approving…' : 'Approve'}
          </Button>
        </div>
      </div>
    )
  }

  private renderEarlier(releases: ReadonlyArray<IPipelineRelease>) {
    return (
      <div className="hotflow-pl-earlier">
        <div className="hotflow-pl-row hotflow-pl-legend">
          <span>Earlier</span>
          <span className="hotflow-pl-bars">
            {Buckets.map(b => (
              <span key={b}>{b.toUpperCase()}</span>
            ))}
          </span>
        </div>
        {releases.map(release => (
          <div key={release.id} className="hotflow-pl-row">
            <span className="hotflow-pl-ver">
              <span className="mono">{releaseLabel(release)}</span>
              <RelativeTime
                date={new Date(release.createdOn)}
                onlyRelative={true}
                className="hotflow-pl-age"
              />
            </span>
            <span className="hotflow-pl-bars">
              {Buckets.map(b => this.renderBar(release, b))}
            </span>
          </div>
        ))}
      </div>
    )
  }

  private renderBar(release: IPipelineRelease, bucket: StageBucket) {
    const stage = stageOf(release, bucket)
    const tone = stage === undefined ? null : stageTone(stage)
    const label = tone === null ? 'not in this pipeline' : tone.label

    return (
      <i
        key={bucket}
        className={classNames(
          'hotflow-pl-bar',
          `tone-${tone === null ? 'idle' : tone.tone}`
        )}
        title={`${bucket.toUpperCase()}: ${label}`}
        role="img"
        aria-label={`${bucket.toUpperCase()}: ${label}`}
      />
    )
  }
}
