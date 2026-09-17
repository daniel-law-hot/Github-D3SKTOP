import * as React from 'react'
import { DialogContent } from '../dialog'
import { Button } from '../lib/button'
import { BuddyRarity, IBuddy } from '../../models/buddy'
import { getBuddy, rerollBuddy } from '../../lib/buddy/buddy-store'

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
  readonly buddy: IBuddy
  readonly pokes: number
  readonly revealed: boolean
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

  public constructor(props: {}) {
    super(props)

    this.state = { buddy: getBuddy(), pokes: 0, revealed: false }
  }

  public componentWillUnmount() {
    this.clearPokeTimer()
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
    if (this.state.revealed) {
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
    this.setState({ buddy: rerollBuddy(), pokes: 0, revealed: false })
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
    if (!this.state.revealed) {
      return null
    }

    return (
      <div className="buddy-reroll">
        <p>
          {this.state.buddy.name} senses your hesitation. Trade them in for
          whatever turns up next?
        </p>
        <div className="buddy-reroll-actions">
          <Button onClick={this.onReroll}>Find another</Button>
          <Button onClick={this.onKeep}>Keep {this.state.buddy.name}</Button>
        </div>
        <p className="buddy-reroll-warning">
          There is no going back to this one.
        </p>
      </div>
    )
  }

  private renderHistory() {
    const { rerolls } = this.state.buddy

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

  public render() {
    const { buddy } = this.state
    const { stats } = buddy

    return (
      <DialogContent>
        <div className="buddy">
          <button
            className="buddy-portrait"
            type="button"
            onClick={this.onPoke}
            aria-label={`${buddy.name}, a ${buddy.species}`}
          >
            <span className="buddy-glyph">{buddy.glyph}</span>
          </button>

          <div className="buddy-identity">
            <h2 className="buddy-name">{buddy.name}</h2>
            <div className="buddy-species">{buddy.species}</div>
            <div className={`buddy-rarity ${buddy.rarity}`}>
              {RarityLabels[buddy.rarity]}
            </div>
            <p className="buddy-blurb">{RarityBlurbs[buddy.rarity]}</p>
          </div>
        </div>

        <div className="buddy-stats">
          {this.renderStat('Focus', stats.focus)}
          {this.renderStat('Stamina', stats.stamina)}
          {this.renderStat('Luck', stats.luck)}
          {this.renderStat('Mischief', stats.mischief)}
        </div>

        {this.renderHistory()}
        {this.renderReroll()}
      </DialogContent>
    )
  }
}
