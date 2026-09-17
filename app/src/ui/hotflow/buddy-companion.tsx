import * as React from 'react'
import classNames from 'classnames'
import { Disposable } from 'event-kit'
import { BuddyRarity, IBuddy } from '../../models/buddy'
import {
  getBuddy,
  onBuddyChanged,
  onBuddySpoke,
} from '../../lib/buddy/buddy-store'
import { levelProgress, MaxLevel } from '../../lib/buddy/xp'
import {
  Popover,
  PopoverAnchorPosition,
  PopoverDecoration,
} from '../lib/popover'
import { LinkButton } from '../lib/link-button'
import { BuddyFigure } from './buddy-figure'

interface IBuddyCompanionProps {
  /** Opens the full tab, from the link in the little panel. */
  readonly onShowBuddy: () => void
}

interface IBuddyCompanionState {
  readonly buddy: IBuddy | null

  /** True while a lap is in progress. Cleared when the animation ends. */
  readonly walking: boolean

  readonly menuOpen: boolean

  /** What it is saying, or null when it is not. */
  readonly saying: string | null
}

const RarityLabels: { readonly [key in BuddyRarity]: string } = {
  [BuddyRarity.Common]: 'Common',
  [BuddyRarity.Uncommon]: 'Uncommon',
  [BuddyRarity.Rare]: 'Rare',
  [BuddyRarity.Epic]: 'Epic',
  [BuddyRarity.Legendary]: 'Legendary',
}

/**
 * The buddy, sitting in the gap along the toolbar or the top right of the
 * schematic.
 *
 * Still by default. Something pacing continuously in the corner of the eye is
 * movement you cannot opt out of while you work, and the walk is more fun as a
 * thing you ask for than a thing that never stops: left click sends it off on
 * one lap, and it comes back to its corner.
 *
 * Absent until somebody has been to Options and found one. It subscribes rather
 * than reading once, because the tab that spawns it sits in a dialog over the
 * top of this and the arrival should be waiting when the dialog closes.
 */
export class BuddyCompanion extends React.Component<
  IBuddyCompanionProps,
  IBuddyCompanionState
> {
  private subscription: Disposable | null = null
  private speech: Disposable | null = null
  private speechTimer: number | null = null
  private buttonRef = React.createRef<HTMLButtonElement>()

  public constructor(props: IBuddyCompanionProps) {
    super(props)

    this.state = {
      buddy: getBuddy(),
      walking: false,
      menuOpen: false,
      saying: null,
    }
  }

  public componentDidMount() {
    this.subscription = onBuddyChanged(buddy => this.setState({ buddy }))
    this.speech = onBuddySpoke(line => this.say(line))
  }

  /**
   * Shows a line for a few seconds.
   *
   * Long enough to read twice, since it arrives while somebody is looking at
   * something else, and gone on its own afterwards — a bubble that needed
   * dismissing would be a chore rather than a pet.
   */
  private say(line: string) {
    this.setState({ saying: line })

    if (this.speechTimer !== null) {
      window.clearTimeout(this.speechTimer)
    }

    this.speechTimer = window.setTimeout(() => {
      this.setState({ saying: null })
      this.speechTimer = null
    }, 6000)
  }

  public componentWillUnmount() {
    this.subscription?.dispose()
    this.subscription = null

    this.speech?.dispose()
    this.speech = null

    if (this.speechTimer !== null) {
      window.clearTimeout(this.speechTimer)
      this.speechTimer = null
    }
  }

  private onClick = () => {
    if (!this.state.walking) {
      this.setState({ walking: true })
    }
  }

  /** One lap, then back to sitting. */
  private onAnimationEnd = () => {
    this.setState({ walking: false })
  }

  private onContextMenu = (event: React.MouseEvent) => {
    // Otherwise the application's own menu opens over the top of this one.
    event.preventDefault()
    event.stopPropagation()

    this.setState({ menuOpen: true })
  }

  private closeMenu = () => {
    this.setState({ menuOpen: false })
  }

  private onShowBuddy = () => {
    this.closeMenu()
    this.props.onShowBuddy()
  }

  /**
   * The level and how far into it, the same as the tab shows.
   *
   * Its own row rather than a fifth stat: the four stats are fixed for the
   * life of a buddy and this is the one number that moves, so filing it
   * among them would be quietly misleading about both.
   */
  private renderLevel(buddy: IBuddy) {
    const progress = levelProgress(buddy.xp)

    return (
      <div className="buddy-level">
        <div className="buddy-level-head">
          <span className="buddy-level-name">
            Level {progress.level}
            {progress.isMax ? ' (max)' : ''}
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

  /**
   * The card, which is the Options tab with everything removed that only makes
   * sense there — no trading one in, and no explanation of the tiers. It is a
   * look at who you have, reachable without leaving what you were doing.
   */
  private renderMenu(buddy: IBuddy) {
    if (!this.state.menuOpen) {
      return null
    }

    return (
      <Popover
        className="buddy-card"
        ariaLabelledby="buddy-card-name"
        anchor={this.buttonRef.current}
        anchorPosition={PopoverAnchorPosition.BottomRight}
        decoration={PopoverDecoration.Balloon}
        onClickOutside={this.closeMenu}
        onMousedownOutside={this.closeMenu}
      >
        <div className="buddy-card-head">
          <span className="buddy-card-glyph">
            <BuddyFigure buddy={buddy} ariaHidden={true} />
          </span>
          <div>
            <h3 id="buddy-card-name">{buddy.name}</h3>
            <div className="buddy-species">{buddy.species}</div>
            <div className={`buddy-rarity ${buddy.rarity}`}>
              {buddy.isShiny ? 'Shiny ' : ''}
              {RarityLabels[buddy.rarity]}
            </div>
          </div>
        </div>

        {this.renderLevel(buddy)}

        <div className="buddy-stats">
          {this.renderStat('Focus', buddy.stats.focus, buddy.grownStats.focus)}
          {this.renderStat(
            'Stamina',
            buddy.stats.stamina,
            buddy.grownStats.stamina
          )}
          {this.renderStat('Luck', buddy.stats.luck, buddy.grownStats.luck)}
          {this.renderStat(
            'Mischief',
            buddy.stats.mischief,
            buddy.grownStats.mischief
          )}
        </div>

        <div className="buddy-card-footer">
          <LinkButton onClick={this.onShowBuddy}>Open in Options</LinkButton>
        </div>
      </Popover>
    )
  }

  public render() {
    const { buddy } = this.state

    if (buddy === null || buddy.hidden) {
      return <div className="hotflow-buddy-run" />
    }

    return (
      <>
        <div className="hotflow-buddy-run">
          <button
            ref={this.buttonRef}
            className={classNames('hotflow-buddy', {
              walking: this.state.walking,
            })}
            type="button"
            onClick={this.onClick}
            onContextMenu={this.onContextMenu}
            onAnimationEnd={this.onAnimationEnd}
            aria-label={`${buddy.name}, your ${buddy.isShiny ? 'shiny ' : ''}${
              buddy.rarity
            } ${
              buddy.species
            }. Click to send them for a walk, right click for details.`}
            title={`${buddy.name} — ${buddy.species}`}
          >
            <span className="hotflow-buddy-glyph">
              <BuddyFigure buddy={buddy} ariaHidden={true} />
            </span>
          </button>
        </div>
        {/*
          Outside the run, which clips what it contains — a card rendered in
          there would be sliced to the height of the strip.

          In a wrapper of its own because Popover decides what counts as an
          outside click by asking whether its parent contains the target. As a
          bare sibling its parent was the whole schematic, or the whole toolbar,
          so nearly every click counted as inside and the card would not close.
        */}
        {/* Outside the run for the same reason the card is: the strip clips
            what it holds, and a bubble sliced to the height of the lane would
            be unreadable. */}
        {this.state.saying !== null && (
          <div className="hotflow-buddy-speech" role="status">
            {this.state.saying}
          </div>
        )}
        <div className="buddy-card-anchor">{this.renderMenu(buddy)}</div>
      </>
    )
  }
}
