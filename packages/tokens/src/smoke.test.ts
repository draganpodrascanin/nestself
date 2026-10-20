import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PKG_ROOT = resolve(import.meta.dirname, '..');
const REPO_ROOT = resolve(PKG_ROOT, '../..');

const tokensJson = JSON.parse(readFileSync(join(PKG_ROOT, 'tokens.json'), 'utf-8'));

// ---------- helpers ----------

function collectFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  if (!existsSync(dir)) return results;

  function walk(d: string) {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (pattern.test(entry.name)) {
        results.push(full);
      }
    }
  }
  walk(dir);
  return results;
}

function hexToLinear(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return [toLinear(r), toLinear(g), toLinear(b)];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToLinear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// ---------- Check 1: CSS blocks match JSON ----------

describe('Check 1: tokens.css palette blocks', () => {
  const css = readFileSync(join(PKG_ROOT, 'tokens.css'), 'utf-8');

  const blockRegex = /(?::root,\s*)?html\[data-palette="(\w+)"\]\[data-mode="(\w+)"\]\s*\{([^}]+)\}/g;
  const blocks: Array<{ palette: string; mode: string; body: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = blockRegex.exec(css)) !== null) {
    blocks.push({ palette: m[1]!, mode: m[2]!, body: m[3]! });
  }

  it('contains exactly 8 palette/mode blocks', () => {
    expect(blocks.length).toBe(8);
  });

  for (const block of blocks) {
    describe(`${block.palette}/${block.mode}`, () => {
      const propRegex = /--(color-[\w-]+)\s*:\s*([^;]+);/g;
      const cssProps: Record<string, string> = {};
      let pm: RegExpExecArray | null;
      while ((pm = propRegex.exec(block.body)) !== null) {
        cssProps[pm[1]!] = pm[2]!.trim();
      }

      const jsonTheme = tokensJson.themes[block.palette]?.[block.mode] as Record<string, string> | undefined;

      it('declares exactly 27 --color-* properties', () => {
        expect(Object.keys(cssProps).length).toBe(27);
      });

      it('property names equal the JSON keys', () => {
        if (!jsonTheme) return;
        const jsonKeys = Object.keys(jsonTheme).map((k) => `color-${k}`).sort();
        const cssKeys = Object.keys(cssProps).sort();
        expect(cssKeys).toEqual(jsonKeys);
      });

      it('every value equals the JSON value case-insensitively', () => {
        if (!jsonTheme) return;
        for (const [jsonKey, jsonValue] of Object.entries(jsonTheme)) {
          const cssKey = `color-${jsonKey}`;
          const cssValue = cssProps[cssKey];
          expect(cssValue?.toLowerCase()).toBe((jsonValue as string).toLowerCase());
        }
      });
    });
  }
});

// ---------- Check 2: contrast report ----------

describe('Check 2: contrast-report.json integrity', () => {
  const report = JSON.parse(readFileSync(join(PKG_ROOT, 'contrast-report.json'), 'utf-8')) as Array<{
    palette: string;
    mode: string;
    foreground: string;
    background: string;
    ratio: number;
    minimum: number;
    passed: boolean;
  }>;

  it('has 120 entries', () => {
    expect(report.length).toBe(120);
  });

  const hexPairRegex = /^#[0-9a-f]{6}$/i;

  for (const entry of report) {
    const fgHex = tokensJson.themes[entry.palette]?.[entry.mode]?.[entry.foreground] as string | undefined;
    const bgHex = tokensJson.themes[entry.palette]?.[entry.mode]?.[entry.background] as string | undefined;

    if (fgHex && bgHex && hexPairRegex.test(fgHex) && hexPairRegex.test(bgHex)) {
      it(`${entry.palette}/${entry.mode} ${entry.foreground} on ${entry.background}: ratio and minimum`, () => {
        const computed = contrastRatio(fgHex, bgHex);
        expect(computed).toBeCloseTo(entry.ratio, 1);
        expect(computed).toBeGreaterThanOrEqual(entry.minimum);
      });
    }
  }
});

// ---------- Check 3: no raw hex in component/app code ----------

describe('Check 3: no raw hex colour literals in component/app code', () => {
  const hexLiteralRegex = /(?<!&)#[0-9a-f]{3,8}\b/i;
  const skipFiles = /\.test\.|routeTree\.gen\.ts/;
  const skipDirs = /[/\\]src[/\\]generated([/\\]|$)/;

  const dirs = [
    join(REPO_ROOT, 'packages/ui/src'),
    join(REPO_ROOT, 'packages/ui-native/src'),
  ];
  // Also scan apps/*/src
  const appsDir = join(REPO_ROOT, 'apps');
  if (existsSync(appsDir)) {
    for (const entry of readdirSync(appsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        dirs.push(join(appsDir, entry.name, 'src'));
      }
    }
  }

  it('no hex colour literals found', () => {
    const violations: string[] = [];
    for (const dir of dirs) {
      const files = collectFiles(dir, /\.(css|ts|tsx)$/);
      for (const file of files) {
        const relFile = file.slice(REPO_ROOT.length + 1);
        if (skipFiles.test(relFile)) continue;
        if (skipDirs.test(relFile)) continue;
        const content = readFileSync(file, 'utf-8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (hexLiteralRegex.test(lines[i]!)) {
            violations.push(`${relFile}:${i + 1}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });
});

// ---------- Check 4: no italic Onest @font-face, has font-synthesis: none ----------

describe('Check 4: fonts.css rules', () => {
  const fontsPath = join(REPO_ROOT, 'packages/assets/fonts/fonts.css');

  it('no @font-face with both Onest and font-style: italic', () => {
    if (!existsSync(fontsPath)) return; // skip if missing
    const css = readFileSync(fontsPath, 'utf-8');
    const faceRegex = /@font-face\s*\{[^}]+\}/g;
    let fm: RegExpExecArray | null;
    while ((fm = faceRegex.exec(css)) !== null) {
      const block = fm[0];
      if (/Onest/i.test(block) && /font-style\s*:\s*italic/i.test(block)) {
        expect.fail(`Found @font-face block declaring both Onest and italic: ${block.slice(0, 80)}`);
      }
    }
  });

  it('contains font-synthesis: none', () => {
    if (!existsSync(fontsPath)) return; // skip if missing
    const css = readFileSync(fontsPath, 'utf-8');
    expect(css).toContain('font-synthesis: none');
  });
});

// ---------- Check 5: default and theme keys ----------

describe('Check 5: default and theme keys', () => {
  it('default equals forest/light/onest', () => {
    expect(tokensJson.default).toEqual({ palette: 'forest', mode: 'light', font: 'onest' });
  });

  it('themes has keys forest, ink, plum, azure', () => {
    expect(Object.keys(tokensJson.themes).sort()).toEqual(['azure', 'forest', 'ink', 'plum']);
  });
});
