/**
 * Writes docs/tasks/calls-webinars/manual/screenshots/INDEX.md after the
 * consultation journeys: every manual screen with its files, route,
 * signed-in role, state and the journey step that produced it; the screens
 * not captured and why; and the defects found on the way.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { test as teardown } from '@playwright/test';
import { DEFECTS, MANUAL_SHOTS, NOT_CAPTURED, SCREENSHOT_DIR, shotFile } from './manual';
import type { ManualShot, ManualShotKey } from './manual';

teardown('write the screenshot index for the user manual', () => {
  const lines: string[] = [
    '# Consultation screenshots for the user manual',
    '',
    'Captured by the consultation journeys (T-CW-1.7, `e2e/calls/consultation.spec.ts`, run with `pnpm exec playwright test -c playwright.calls.config.ts`) against the real API with the in-process `FakeVideoProvider`, Chromium\'s fake camera and microphone, English locale, device scale factor 2: desktop 1280 x 800 and mobile 390 x 844. Viewport captures, not full pages. This file is rewritten after every run.',
    '',
    'People on screen are the fictional sample people: Jovan Petrović (employee) and Milica Ristić (expert). In-call video is a drawn placeholder captioned "Sample video"; the pre-join preview is Chromium\'s fake camera test pattern. Nothing is masked; no real personal data appears.',
    '',
    '| # | Files | Route | Signed in as | State shown | Journey step |',
    '| --- | --- | --- | --- | --- | --- |',
  ];
  const missing: ManualShotKey[] = [];
  for (const [key, entry] of Object.entries(MANUAL_SHOTS) as Array<[ManualShotKey, ManualShot]>) {
    const viewports = entry.only ? [entry.only] : (['desktop', 'mobile'] as const);
    const files = viewports.map((viewport) => shotFile(key, viewport)).filter((file) => fs.existsSync(path.join(SCREENSHOT_DIR, file)));
    if (files.length === 0) {
      missing.push(key);
      continue;
    }
    const absent = viewports.length - files.length;
    lines.push(
      `| ${entry.n} | ${files.map((file) => `[${file}](${file})`).join('<br>')}${absent ? ' (one viewport missing)' : ''} | \`${entry.route}\` | ${entry.role} | ${entry.state} | ${entry.step} |`,
    );
  }
  lines.push('', '## Not captured', '');
  if (missing.length === 0) lines.push('Every screen was captured.');
  for (const key of missing) {
    const entry = MANUAL_SHOTS[key];
    lines.push(`- ${entry.n}. \`${key}\` (${entry.route}): ${NOT_CAPTURED[key] ?? 'not produced by the last run; see the journey report (e2e/playwright-report/calls).'}`);
  }
  lines.push('', '## Defects found while capturing', '');
  for (const defect of DEFECTS) {
    lines.push(`- **${defect.id}**: ${defect.summary} ${defect.effect} ${defect.fixedBy ? `Fixed by ${defect.fixedBy}; the screens were recaptured after the fix.` : 'Open.'}`);
  }
  lines.push('');
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
  fs.writeFileSync(path.join(SCREENSHOT_DIR, 'INDEX.md'), lines.join('\n'));
});
