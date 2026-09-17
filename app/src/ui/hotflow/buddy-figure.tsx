import * as React from 'react'
import classNames from 'classnames'
import { IBuddy, IBuddyHat } from '../../models/buddy'
import {
  hatArtFor,
  hatDropFor,
  hatFitFor,
  IHatFit,
} from '../../lib/buddy/hat-fit'

interface IBuddyFigureProps {
  readonly buddy: IBuddy

  /** Set where the figure is decoration beside its own name and tier. */
  readonly ariaHidden?: boolean
}

/**
 * Where this hat goes on this animal.
 *
 * Inline rather than in the stylesheet because it is per-species data — a rule
 * can say that hats tilt, but not that a tortoise wears one down by its front
 * left foot. Everything is in fractions of the figure's own box, so one set of
 * numbers holds at 34px in the toolbar and 88px in Options.
 */
function hatStyle(fit: IHatFit, hat: IBuddyHat): React.CSSProperties {
  return {
    left: `${fit.x * 100}%`,
    top: `${fit.y * 100}%`,
    fontSize: `${fit.scale}em`,

    // Read by the transform in _buddy.scss. Cast because a custom property is
    // not something React's style type knows how to spell.
    ['--hat-drop' as string]: `${hatDropFor(hat.name)}em`,
  } as React.CSSProperties
}

/**
 * The animal, and whatever it is wearing.
 *
 * One component for all three places that draw a buddy — the toolbar, the card
 * and the tab — because the hat has to sit in the same spot relative to the head
 * at every size, and three copies of that arithmetic would drift apart on the
 * first adjustment.
 *
 * Shiny inverts the whole figure rather than the animal alone: a buddy in the
 * wrong colours wearing a hat in the right ones looks like a rendering fault
 * rather than a rare find.
 */
export class BuddyFigure extends React.Component<IBuddyFigureProps> {
  /**
   * A hat is a character, unless nobody ever drew that character.
   *
   * The picture hangs by its own bottom edge, which the file is trimmed to, so
   * it lands on the head exactly where a glyph's ink would — one placement
   * table for both kinds.
   */
  private renderHat(hat: IBuddyHat) {
    const art = hatArtFor(hat.name)

    if (art === null) {
      return hat.glyph
    }

    return (
      <img
        className="buddy-figure-hat-art"
        src={art.src}
        style={{ width: `${art.width}em` }}
        alt=""
      />
    )
  }

  public render() {
    const { buddy, ariaHidden } = this.props
    const { hat } = buddy

    return (
      <span
        className={classNames('buddy-figure', { shiny: buddy.isShiny })}
        aria-hidden={ariaHidden}
      >
        <span className="buddy-figure-glyph">{buddy.glyph}</span>
        {hat !== null && (
          <span
            className="buddy-figure-hat"
            style={hatStyle(hatFitFor(buddy.species), hat)}
          >
            {this.renderHat(hat)}
          </span>
        )}
      </span>
    )
  }
}
