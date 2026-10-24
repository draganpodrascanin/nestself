import { describe, expect, it } from 'vitest';
import { motion as motionTokens } from '@nestself/tokens';
import { motionDuration, motionEase, motionPresets, reducedMotionPresets } from './presets';
import type { MotionPreset, MotionPresetName } from './presets';

type Target = Record<string, unknown>;

const names = Object.keys(motionPresets) as MotionPresetName[];
const TOKEN_DURATIONS = [motionDuration.fast, motionDuration.standard, motionDuration.slow];
/** Values each preset may animate; everything else would leave the compositor. */
const ALLOWED_VALUES: Record<MotionPresetName, string[]> = {
  backdrop: ['opacity'],
  dialog: ['opacity', 'transform'],
  popover: ['opacity', 'transform'],
  'sheet-bottom': ['transform'],
  'sheet-left': ['transform'],
  'sheet-right': ['transform'],
  // Motion's layout projection owns `transform`, so toasts use the shorthands.
  toast: ['opacity', 'y', 'scale'],
  disclosure: ['height', 'opacity', 'visibility'],
};
const MOVEMENT = ['transform', 'x', 'y', 'scale', 'rotate'];

function animatedKeys(target: Target): string[] {
  return Object.keys(target).filter((key) => key !== 'transition' && key !== 'transitionEnd');
}

function targets(preset: MotionPreset): Target[] {
  return [preset.initial, preset.animate, preset.exit] as Target[];
}

function transitionsOf(preset: MotionPreset) {
  return [preset.animate.transition, preset.exit.transition] as Array<Record<string, unknown>>;
}

/** `translate3d(0px, 8px, 0px) scale(0.97)` -> `translate3d,scale` */
function transformFunctions(value: unknown): string {
  return String(value)
    .split(')')
    .map((part) => part.trim().split('(')[0])
    .filter(Boolean)
    .join(',');
}

describe('motion tokens', () => {
  it('durations come from tokens.json, in seconds', () => {
    expect(motionDuration.fast).toBe(motionTokens.fastMs / 1000);
    expect(motionDuration.standard).toBe(motionTokens.standardMs / 1000);
    expect(motionDuration.slow).toBe(motionTokens.slowMs / 1000);
    expect(motionDuration.reducedFade).toBe(motionTokens.reducedFadeMaxMs / 1000);
  });

  it('easing is the design-system curve cubic-bezier(.2, 0, 0, 1)', () => {
    expect(motionEase).toEqual(motionTokens.easing);
    expect(motionEase).toEqual([0.2, 0, 0, 1]);
  });
});

describe.each(names)('preset %s', (name) => {
  const preset = motionPresets[name];

  it('animates only compositor-friendly values (or the documented exception)', () => {
    for (const target of targets(preset)) {
      for (const key of animatedKeys(target)) expect(ALLOWED_VALUES[name]).toContain(key);
    }
  });

  it('times every transition with a token duration and the standard easing', () => {
    for (const transition of transitionsOf(preset)) {
      expect(TOKEN_DURATIONS).toContain(transition.duration);
      expect(transition.ease).toEqual(motionEase);
    }
  });

  it('never exits slower than it enters', () => {
    const [enter, exit] = transitionsOf(preset);
    expect(exit?.duration as number).toBeLessThanOrEqual(enter?.duration as number);
  });

  it('exits through opacity or transform, which Base UI can detect and wait for', () => {
    const exitKeys = animatedKeys(preset.exit as Target);
    expect(exitKeys.some((key) => ['opacity', 'transform'].includes(key))).toBe(true);
  });

  it('keeps one transform function list across keyframes so it interpolates', () => {
    const transforms = targets(preset)
      .map((target) => target.transform)
      .filter((value) => value !== undefined)
      .map(transformFunctions);
    expect(new Set(transforms).size).toBeLessThanOrEqual(1);
  });

  it('starts from the state it exits to, so a reversed exit looks like the entry', () => {
    for (const key of animatedKeys(preset.initial as Target)) {
      if (key === 'visibility' || (name === 'toast' && key === 'y')) continue;
      expect((preset.exit as Target)[key]).toEqual((preset.initial as Target)[key]);
    }
  });
});

describe.each(names)('reduced preset %s', (name) => {
  const preset = reducedMotionPresets[name];

  it('has no translate, scale or other movement', () => {
    for (const target of targets(preset)) {
      for (const key of animatedKeys(target)) expect(MOVEMENT).not.toContain(key);
    }
  });

  it('fades for at most 50 ms and changes size instantly', () => {
    for (const transition of transitionsOf(preset)) {
      expect(transition.duration as number).toBeLessThanOrEqual(motionDuration.reducedFade);
      if (transition.height) expect((transition.height as { duration: number }).duration).toBe(0);
    }
  });
});
