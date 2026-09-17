import * as React from 'react'
import classNames from 'classnames'
import { DialogContent } from '../dialog'
import { Button } from '../lib/button'
import { Checkbox, CheckboxValue } from '../lib/checkbox'
import { BuddyFigure } from '../hotflow/buddy-figure'
import { BuddyRarity, IBuddy } from '../../models/buddy'
import {
  getBuddy,
  polishBuddy,
  rerollBuddy,
  setBuddyHidden,
  spawnBuddy,
} from '../../lib/buddy/buddy-store'
import { levelProgress, MaxLevel } from '../../lib/buddy/xp'

/**
 * A double click on the portrait, and how far apart the two halves can be.
 *
 * Hidden rather than secret. Nothing labels it, so the first time is always an
 * accident — but a picture of an animal is a thing people click twice, so it
 * gets found.
 *
 * Counted as two activations rather than taken from the browser's `dblclick`,
 * which never fires for somebody working from the keyboard: two presses of
 * Enter on a button send two clicks and no double click at all. The window is a
 * little longer than Windows' own double-click default, so a deliberate but
 * unhurried pair still counts — this is more forgiving than `dblclick`, never
 * less.
 */
const ClicksToReveal = 2
const ClickWindowMs = 600

interface IBuddyPreferencesState {
  /** Null until somebody goes looking, which is the whole of the opening move. */
  readonly buddy: IBuddy | null

  readonly clicks: number
  readonly revealed: boolean

  /** Set for a moment after one arrives, so the first sight of it is an event. */
  readonly arriving: boolean
}

const RarityLabels: { readonly [key in BuddyRarity]: string } = {
  [BuddyRarity.Common]: 'Common',
  [BuddyRarity.Uncommon]: 'Uncommon',
  [BuddyRarity.Rare]: 'Rare',
  [BuddyRarity.Epic]: 'Epic',
  [BuddyRarity.Legendary]: 'Legendary',
}

/** What the buddy says about itself, which is never about the numbers. */
const RarityBlurbs: { readonly [key in BuddyRarity]: string } = {
  [BuddyRarity.Common]: 'Turns up everywhere. Reliable about it.',
  [BuddyRarity.Uncommon]: 'You could go a while without meeting another.',
  [BuddyRarity.Rare]: 'Worth mentioning to somebody.',
  [BuddyRarity.Epic]: 'Genuinely hard to come by.',
  [BuddyRarity.Legendary]: 'One in a hundred. Do not let it near the release.',
}

export class BuddyPreferences extends React.Component<
  {},
  IBuddyPreferencesState
> {
  private clickTimer: number | null = null
  private arrivalTimer: number | null = null

  public constructor(props: {}) {
    super(props)

    this.state = {
      buddy: getBuddy(),
      clicks: 0,
      revealed: false,
      arriving: false,
    }
  }

  public componentWillUnmount() {
    this.clearClickTimer()
    this.clearArrivalTimer()
  }

  private clearArrivalTimer() {
    if (this.arrivalTimer !== null) {
      window.clearTimeout(this.arrivalTimer)
      this.arrivalTimer = null
    }
  }

  private onSpawn = () => {
    this.setState({ buddy: spawnBuddy(), arriving: true })

    this.clearArrivalTimer()

    this.arrivalTimer = window.setTimeout(() => {
      this.setState({ arriving: false })
      this.arrivalTimer = null
    }, 900)
  }

  private clearClickTimer() {
    if (this.clickTimer !== null) {
      window.clearTimeout(this.clickTimer)
      this.clickTimer = null
    }
  }

  /**
   * A button rather than a div, so the gesture is reachable from the keyboard.
   *
   * An easter egg that only exists for people who can use a mouse is one that
   * quietly tells some of your colleagues it was not meant for them.
   */
  private onPortraitClick = () => {
    if (this.state.revealed || this.state.buddy === null) {
      return
    }

    const clicks = this.state.clicks + 1

    this.clearClickTimer()

    if (clicks >= ClicksToReveal) {
      this.setState({ clicks: 0, revealed: true })
      return
    }

    this.setState({ clicks })

    this.clickTimer = window.setTimeout(() => {
      this.setState({ clicks: 0 })
      this.clickTimer = null
    }, ClickWindowMs)
  }

  private onReroll = () => {
    this.setState({
      buddy: rerollBuddy(),
      clicks: 0,
      revealed: false,
      arriving: true,
    })

    this.clearArrivalTimer()

    this.arrivalTimer = window.setTimeout(() => {
      this.setState({ arriving: false })
      this.arrivalTimer = null
    }, 900)
  }

  private onPolish = () => {
    this.setState({ buddy: polishBuddy(), arriving: true })

    this.clearArrivalTimer()

    this.arrivalTimer = window.setTimeout(() => {
      this.setState({ arriving: false })
      this.arrivalTimer = null
    }, 900)
  }

  /**
   * The level, and how far into it.
   *
   * Experience comes from committing, by the lines a commit touched, and the
   * curve is deliberately long — a maxed buddy should mean somebody has been
   * here the better part of a year. The numbers are shown because a bar with no
   * numbers is a bar people invent theories about.
   */
  private renderLevel(buddy: IBuddy) {
    const progress = levelProgress(buddy.xp)

    return (
      <div className="buddy-level">
        <div className="buddy-level-head">
          <span className="buddy-level-name">
            Level {progress.level}
            {progress.isMax ? ' — as far as they go' : ''}
          </span>
          <span className="buddy-level-xp">
            {progress.isMax
              ? `${buddy.xp} experience`
              : `${progress.into} / ${progress.needed}`}
          </span>
        </div>
        <div
          className="buddy-stat-track"
          role="img"
          aria-label={`Level ${progress.level} of ${MaxLevel}`}
        >
          <div
            className="buddy-stat-fill"
            style={{ width: `${Math.round(progress.fraction * 100)}%` }}
          />
        </div>
      </div>
    )
  }

  /** The reward for getting there, offered once and never taken back. */
  private renderPolish(buddy: IBuddy) {
    if (buddy.level < MaxLevel) {
      return null
    }

    if (buddy.isShiny) {
      return (
        <p className="buddy-history">
          There is nothing left to earn. {buddy.name} shines already.
        </p>
      )
    }

    return (
      <div className="buddy-reroll">
        <p>
          {buddy.name} has gone as far as they go. You can change their colours
          for good.
        </p>
        <div className="buddy-reroll-actions">
          <Button onClick={this.onPolish}>Make {buddy.name} shiny</Button>
        </div>
      </div>
    )
  }

  private onHiddenChanged = (event: React.FormEvent<HTMLInputElement>) => {
    this.setState({ buddy: setBuddyHidden(!event.currentTarget.checked) })
  }

  /**
   * Putting the buddy away.
   *
   * There are meetings, demonstrations and screen shares where a lizard
   * wandering the toolbar is not what anybody wants on the projector, and the
   * answer to that should not be uninstalling the feature. Hiding leaves
   * everything intact — the level, the experience, the animal — and this tab
   * still shows them, so the way back is where the way out was.
   */
  private renderVisibility(buddy: IBuddy) {
    return (
      <div className="buddy-visibility">
        <Checkbox
          label={`Show ${buddy.name} in the toolbar and in HotFlow`}
          value={buddy.hidden ? CheckboxValue.Off : CheckboxValue.On}
          onChange={this.onHiddenChanged}
        />
        <p className="buddy-visibility-why">
          Hidden, {buddy.name} keeps their level and stays out of the way.
          Nothing is lost and nothing is said.
        </p>
      </div>
    )
  }

  private onKeep = () => {
    this.setState({ revealed: false, clicks: 0 })
  }

  private renderStat(label: string, base: number, grown: number) {
    const gained = Math.max(0, grown - base)

    return (
      <div className="buddy-stat" key={label}>
        <div className="buddy-stat-label">{label}</div>
        <div
          className="buddy-stat-track"
          role="img"
          aria-label={
            gained > 0
              ? `${label} ${grown} out of 100, ${gained} of it earned`
              : `${label} ${grown} out of 100`
          }
        >
          <div className="buddy-stat-fill" style={{ width: `${base}%` }} />
          {gained > 0 && (
            <div className="buddy-stat-gain" style={{ width: `${gained}%` }} />
          )}
        </div>
        <div className="buddy-stat-value">
          {grown}
          {gained > 0 && <span className="buddy-stat-earned">+{gained}</span>}
        </div>
      </div>
    )
  }

  private renderReroll() {
    const { buddy } = this.state

    if (!this.state.revealed || buddy === null) {
      return null
    }

    return (
      <div className="buddy-reroll">
        <p>
          {buddy.name} senses your hesitation. Trade them in for whatever turns
          up next?
        </p>
        <div className="buddy-reroll-actions">
          {/* Blunt on purpose. "Find another" made it sound like browsing,
              and this ends a companion somebody may have spent months on. */}
          <Button onClick={this.onReroll}>Murder your buddy</Button>
          <Button onClick={this.onKeep}>Keep {buddy.name}</Button>
        </div>
        <p className="buddy-reroll-warning">
          There is no going back to this one
          {buddy.level > 1 ? `, and level ${buddy.level} goes with them` : ''}.
        </p>
      </div>
    )
  }

  private renderHistory() {
    const rerolls = this.state.buddy?.rerolls ?? 0

    if (rerolls === 0) {
      return null
    }

    return (
      <p className="buddy-history">
        {rerolls === 1
          ? 'One other has been sent away to get here.'
          : `${rerolls} others have been sent away to get here.`}
      </p>
    )
  }

  /**
   * Before there is anybody.
   *
   * No mention of rarity, stats or trading one in: everything this feature does
   * is more fun found than announced, and a screen that explained the odds first
   * would turn meeting yours into collecting one.
   */
  private renderEmpty() {
    return (
      <DialogContent>
        <div className="buddy-empty">
          <div className="buddy-empty-glyph" aria-hidden="true">
            🥚
          </div>
          <h2>Nobody yet</h2>
          <p>
            Something is out there. It has not been introduced to you, and it
            will not turn up on its own.
          </p>
          <Button type="submit" onClick={this.onSpawn}>
            Go and look
          </Button>
        </div>
      </DialogContent>
    )
  }

  public render() {
    const { buddy } = this.state

    if (buddy === null) {
      return this.renderEmpty()
    }

    const { stats, grownStats: grown } = buddy

    return (
      <DialogContent>
        <div className={classNames('buddy', { arriving: this.state.arriving })}>
          <button
            className="buddy-portrait"
            type="button"
            onClick={this.onPortraitClick}
            aria-label={`${buddy.name}, a ${buddy.species}`}
          >
            <span className="buddy-glyph">
              <BuddyFigure buddy={buddy} ariaHidden={true} />
            </span>
          </button>

          <div className="buddy-identity">
            <h2 className="buddy-name">{buddy.name}</h2>
            <div className="buddy-species">{buddy.species}</div>
            <div className={`buddy-rarity ${buddy.rarity}`}>
              {buddy.isShiny ? 'Shiny ' : ''}
              {RarityLabels[buddy.rarity]}
            </div>
            <p className="buddy-blurb">
              {buddy.isShiny
                ? 'The colours are wrong. One in eight thousand and ninety-two are.'
                : RarityBlurbs[buddy.rarity]}
            </p>
          </div>
        </div>

        <div className="buddy-stats">
          {this.renderStat('Focus', stats.focus, grown.focus)}
          {this.renderStat('Stamina', stats.stamina, grown.stamina)}
          {this.renderStat('Luck', stats.luck, grown.luck)}
          {this.renderStat('Mischief', stats.mischief, grown.mischief)}
        </div>

        {this.renderLevel(buddy)}
        {this.renderPolish(buddy)}
        {this.renderHistory()}
        {this.renderVisibility(buddy)}
        {this.renderReroll()}
      </DialogContent>
    )
  }
}
