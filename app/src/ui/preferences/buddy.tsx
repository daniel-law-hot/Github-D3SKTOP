import * as React from 'react'
import classNames from 'classnames'
import { DialogContent } from '../dialog'
import { Button } from '../lib/button'
import { BuddyRarity, IBuddy } from '../../models/buddy'
import {
  getBuddy,
  polishBuddy,
  rerollBuddy,
  spawnBuddy,
} from '../../lib/buddy/buddy-store'
import { levelProgress, MaxLevel } from '../../lib/buddy/xp'

/**
 * How many pokes reveal the way out, and how long you have to do them in.
 *
 * Hidden rather than secret. Nothing labels it, so the first time is always an
 * accident — but prodding an animal repeatedly is the obvious thing to do with
 * one, so it gets found.
 */
const PokesToReveal = 5
const PokeWindowMs = 3000

interface IBuddyPreferencesState {
  /** Null until somebody goes looking, which is the whole of the opening move. */
  readonly buddy: IBuddy | null

  readonly pokes: number
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
  private pokeTimer: number | null = null
  private arrivalTimer: number | null = null

  public constructor(props: {}) {
    super(props)

    this.state = {
      buddy: getBuddy(),
      pokes: 0,
      revealed: false,
      arriving: false,
    }
  }

  public componentWillUnmount() {
    this.clearPokeTimer()
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

  private clearPokeTimer() {
    if (this.pokeTimer !== null) {
      window.clearTimeout(this.pokeTimer)
      this.pokeTimer = null
    }
  }

  /**
   * A button rather than a div, so the gesture is reachable from the keyboard.
   *
   * An easter egg that only exists for people who can use a mouse is one that
   * quietly tells some of your colleagues it was not meant for them.
   */
  private onPoke = () => {
    if (this.state.revealed || this.state.buddy === null) {
      return
    }

    const pokes = this.state.pokes + 1

    this.clearPokeTimer()

    if (pokes >= PokesToReveal) {
      this.setState({ pokes: 0, revealed: true })
      return
    }

    this.setState({ pokes })

    this.pokeTimer = window.setTimeout(() => {
      this.setState({ pokes: 0 })
      this.pokeTimer = null
    }, PokeWindowMs)
  }

  private onReroll = () => {
    this.setState({
      buddy: rerollBuddy(),
      pokes: 0,
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

  private onKeep = () => {
    this.setState({ revealed: false, pokes: 0 })
  }

  private renderStat(label: string, value: number) {
    return (
      <div className="buddy-stat" key={label}>
        <div className="buddy-stat-label">{label}</div>
        <div
          className="buddy-stat-track"
          role="img"
          aria-label={`${label} ${value} out of 99`}
        >
          <div className="buddy-stat-fill" style={{ width: `${value}%` }} />
        </div>
        <div className="buddy-stat-value">{value}</div>
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
          <Button onClick={this.onReroll}>Find another</Button>
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

    const { stats } = buddy

    return (
      <DialogContent>
        <div className={classNames('buddy', { arriving: this.state.arriving })}>
          <button
            className="buddy-portrait"
            type="button"
            onClick={this.onPoke}
            aria-label={`${buddy.name}, a ${buddy.species}`}
          >
            <span
              className={classNames('buddy-glyph', { shiny: buddy.isShiny })}
            >
              {buddy.glyph}
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
          {this.renderStat('Focus', stats.focus)}
          {this.renderStat('Stamina', stats.stamina)}
          {this.renderStat('Luck', stats.luck)}
          {this.renderStat('Mischief', stats.mischief)}
        </div>

        {this.renderLevel(buddy)}
        {this.renderPolish(buddy)}
        {this.renderHistory()}
        {this.renderReroll()}
      </DialogContent>
    )
  }
}
