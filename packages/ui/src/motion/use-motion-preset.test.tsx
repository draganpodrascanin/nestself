import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { motionPresets, reducedMotionPresets } from './presets';

const reduced = vi.hoisted(() => ({ value: false as boolean | null }));
vi.mock('motion/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => reduced.value,
}));

const { useMotionPreset } = await import('./use-motion-preset');

describe('useMotionPreset', () => {
  it('returns the full preset when motion is allowed', () => {
    reduced.value = false;
    const { result } = renderHook(() => useMotionPreset('dialog'));
    expect(result.current).toBe(motionPresets.dialog);
  });

  it('returns the full preset before the preference is known (server render)', () => {
    reduced.value = null;
    const { result } = renderHook(() => useMotionPreset('popover'));
    expect(result.current).toBe(motionPresets.popover);
  });

  it('returns the reduced variant when the person asks for reduced motion', () => {
    reduced.value = true;
    const { result } = renderHook(() => useMotionPreset('sheet-right'));
    expect(result.current).toBe(reducedMotionPresets['sheet-right']);
  });
});
