import { motion as motionTokens } from '@nestself/tokens';
import type { Target, TargetAndTransition, Transition } from 'motion/react';

/**
 * Motion presets for every component that appears, disappears, pops out or
 * expands. Timing comes from the design tokens only (tokens.json
 * `primitive.motion`): fast 120 ms for hover, press and small exits,
 * standard 200 ms for menus, dialogs and content, slow 280 ms for sheets,
 * drawers and larger context changes, all on cubic-bezier(.2, 0, 0, 1).
 *
 * Smoothness contract: presets animate `opacity` and a full `transform`
 * string. Motion hands exactly those to the Web Animations API, so they run
 * on the compositor and stay smooth while React mounts the popup's content.
 * The `x` / `y` / `scale` shorthands run on the main thread; only the toast
 * preset uses them, because Motion's `layout` projection owns `transform`.
 * Every exit animates `opacity` or `transform` through the Web Animations
 * API, which is how Base UI detects the exit and waits for it before it
 * unmounts or hides the popup.
 */

const seconds = (ms: number) => ms / 1000;

/** Token durations in seconds (Motion's unit). */
export const motionDuration = {
  fast: seconds(motionTokens.fastMs),
  standard: seconds(motionTokens.standardMs),
  slow: seconds(motionTokens.slowMs),
  /** Upper bound for the optional fade that replaces motion under reduced motion. */
  reducedFade: seconds(motionTokens.reducedFadeMaxMs),
} as const;

/** The standard entry and exit easing, cubic-bezier(.2, 0, 0, 1). */
export const motionEase = motionTokens.easing as unknown as [number, number, number, number];

function tween(duration: number): Transition {
  return { type: 'tween', duration, ease: motionEase };
}

export interface MotionPreset {
  initial: Target;
  animate: TargetAndTransition;
  exit: TargetAndTransition;
}

export type MotionPresetName =
  | 'backdrop'
  | 'dialog'
  | 'popover'
  | 'sheet-bottom'
  | 'sheet-left'
  | 'sheet-right'
  | 'toast'
  | 'disclosure';

/**
 * Transform strings keep the same function list at every keyframe so both
 * the browser and Motion's JS fallback interpolate them component by
 * component.
 */
const DIALOG_REST = 'translate3d(0px, 0px, 0px) scale(1)';
const DIALOG_AWAY = 'translate3d(0px, 8px, 0px) scale(0.97)';
const POPOVER_REST = 'scale(1)';
const POPOVER_AWAY = 'scale(0.96)';
const SHEET_REST = 'translate3d(0%, 0%, 0px)';
const SHEET_AWAY = {
  bottom: 'translate3d(0%, 100%, 0px)',
  left: 'translate3d(-100%, 0%, 0px)',
  right: 'translate3d(100%, 0%, 0px)',
} as const;

function sheet(side: keyof typeof SHEET_AWAY): MotionPreset {
  return {
    initial: { transform: SHEET_AWAY[side] },
    animate: { transform: SHEET_REST, transition: tween(motionDuration.slow) },
    exit: { transform: SHEET_AWAY[side], transition: tween(motionDuration.standard) },
  };
}

export const motionPresets: Record<MotionPresetName, MotionPreset> = {
  /** Scrim behind dialogs and sheets. */
  backdrop: {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: tween(motionDuration.standard) },
    exit: { opacity: 0, transition: tween(motionDuration.standard) },
  },
  /** Centred dialog and alert dialog: rises 8 px and settles from 97 %. */
  dialog: {
    initial: { opacity: 0, transform: DIALOG_AWAY },
    animate: { opacity: 1, transform: DIALOG_REST, transition: tween(motionDuration.standard) },
    exit: { opacity: 0, transform: DIALOG_AWAY, transition: tween(motionDuration.fast) },
  },
  /**
   * Anchored popups (menu, select, popover, tooltip). Pair with
   * `origin-[var(--transform-origin)]` so the popup grows out of its trigger.
   */
  popover: {
    initial: { opacity: 0, transform: POPOVER_AWAY },
    animate: { opacity: 1, transform: POPOVER_REST, transition: tween(motionDuration.standard) },
    exit: { opacity: 0, transform: POPOVER_AWAY, transition: tween(motionDuration.fast) },
  },
  /** Bottom sheet. */
  'sheet-bottom': sheet('bottom'),
  /** Drawer from the inline start edge. */
  'sheet-left': sheet('left'),
  /** Drawer from the inline end edge. */
  'sheet-right': sheet('right'),
  /** Toast entering the stack from below; siblings glide with `layout`. */
  toast: {
    initial: { opacity: 0, y: 16, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: tween(motionDuration.standard) },
    exit: { opacity: 0, y: 0, scale: 0.98, transition: tween(motionDuration.fast) },
  },
  /**
   * Disclosure (mobile navigation, show-more panels): height is the one
   * layout property we animate, because the content below has to move.
   * The collapsed panel ends `visibility: hidden`, so a disclosure that stays
   * mounted takes its links out of the tab order and the accessibility tree.
   */
  disclosure: {
    initial: { height: 0, opacity: 0, visibility: 'hidden' },
    animate: {
      height: 'auto',
      opacity: 1,
      visibility: 'visible',
      transition: tween(motionDuration.standard),
    },
    exit: {
      height: 0,
      opacity: 0,
      transition: tween(motionDuration.fast),
      transitionEnd: { visibility: 'hidden' },
    },
  },
};

const reducedFade: MotionPreset = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: tween(motionDuration.reducedFade) },
  exit: { opacity: 0, transition: tween(motionDuration.reducedFade) },
};

/**
 * Reduced-motion variants (design system: 0 ms, optional fade up to 50 ms,
 * no translate, scale or parallax). Sizes still change, but instantly.
 */
export const reducedMotionPresets: Record<MotionPresetName, MotionPreset> = {
  backdrop: reducedFade,
  dialog: reducedFade,
  popover: reducedFade,
  'sheet-bottom': reducedFade,
  'sheet-left': reducedFade,
  'sheet-right': reducedFade,
  toast: reducedFade,
  disclosure: {
    initial: { height: 0, opacity: 0, visibility: 'hidden' },
    animate: {
      height: 'auto',
      opacity: 1,
      visibility: 'visible',
      transition: { ...tween(motionDuration.reducedFade), height: { duration: 0 } },
    },
    exit: {
      height: 0,
      opacity: 0,
      transition: { ...tween(motionDuration.reducedFade), height: { duration: 0 } },
      transitionEnd: { visibility: 'hidden' },
    },
  },
};
