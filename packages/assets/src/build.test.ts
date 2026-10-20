import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { existsSync, statSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('build-images.mjs', { timeout: 120_000 }, () => {
  it('produces family-carry variants for width 480 and all 6 role crops', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'nestself-build-test-'));
    const scriptPath = join(import.meta.dirname, '..', 'scripts', 'build-images.mjs');
    execSync(`node ${scriptPath} --only family-carry --widths 480`, {
      env: { ...process.env, NESTSELF_IMAGES_OUT: tmp },
      stdio: 'pipe',
      timeout: 110_000,
    });

    // Width variants
    for (const ext of ['avif', 'webp', 'jpg']) {
      const f = join(tmp, 'family-carry', `family-carry-480.${ext}`);
      expect(existsSync(f), `${f} should exist`).toBe(true);
      expect(statSync(f).size).toBeGreaterThan(1000);
    }

    // Role crops
    const roles = ['hero-3x2', 'hero-4x5', 'portrait', 'card', 'avatar', 'article'];
    for (const role of roles) {
      for (const ext of ['avif', 'webp', 'jpg']) {
        const f = join(tmp, 'family-carry', `family-carry-${role}.${ext}`);
        expect(existsSync(f), `${f} should exist`).toBe(true);
        expect(statSync(f).size).toBeGreaterThan(1000);
      }
    }
  });
});
