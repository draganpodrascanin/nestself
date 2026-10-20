import { describe, expect, it } from 'vitest';
import { nativeThemes, nativeType } from './native.js';
import type { NativeColors } from './native.js';
import tokensJson from '../tokens.json';

const palettes = ['forest', 'ink', 'plum', 'azure'] as const;
const modes = ['light', 'dark'] as const;

const EXPECTED_KEYS: (keyof NativeColors)[] = [
  'canvas', 'surface', 'raised', 'tint', 'text', 'textSecondary',
  'borderSubtle', 'borderControl', 'primary', 'primaryHover', 'primaryPressed',
  'onPrimary', 'accent', 'onAccent', 'accentSoft', 'focus',
  'disabledSurface', 'disabledText', 'scrim', 'success', 'successSurface',
  'warning', 'warningSurface', 'danger', 'dangerSurface', 'info', 'infoSurface',
];

function kebabToCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

describe('nativeThemes', () => {
  for (const palette of palettes) {
    for (const mode of modes) {
      describe(`${palette}/${mode}`, () => {
        it('has all 27 keys', () => {
          const colors = nativeThemes[palette][mode];
          const keys = Object.keys(colors);
          expect(keys.length).toBe(27);
          for (const key of EXPECTED_KEYS) {
            expect(colors).toHaveProperty(key);
          }
        });

        it('values equal the JSON (kebab to camel)', () => {
          const colors = nativeThemes[palette][mode];
          const jsonColors = (tokensJson.themes as unknown as Record<string, Record<string, Record<string, string>>>)[palette]![mode]!;
          for (const [jsonKey, jsonValue] of Object.entries(jsonColors)) {
            const camelKey = kebabToCamel(jsonKey) as keyof NativeColors;
            expect(colors[camelKey]).toBe(jsonValue);
          }
        });
      });
    }
  }
});

describe('nativeType', () => {
  it('ios body fontSize is 17', () => {
    expect(nativeType.ios.body.fontSize).toBe(17);
  });

  it('android body fontSize is 16', () => {
    expect(nativeType.android.body.fontSize).toBe(16);
  });

  it('all weights are strings', () => {
    for (const platform of ['ios', 'android'] as const) {
      for (const role of Object.keys(nativeType[platform]) as Array<keyof typeof nativeType.ios>) {
        const spec = nativeType[platform][role];
        expect(typeof spec.fontWeight).toBe('string');
      }
    }
  });

  it('display letterSpacing matches trackingEm * fontSize', () => {
    // display has trackingEm.ios = 0, so letterSpacing = 0
    expect(nativeType.ios.display.letterSpacing).toBe(0);
    expect(nativeType.android.display.letterSpacing).toBe(0);
  });
});
