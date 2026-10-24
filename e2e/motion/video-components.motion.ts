/**
 * Motion suite entries for the consultation call client (`packages/video`,
 * guidelines 17.4, CW-R-89): every panel, overlay, cue, menu, sheet and card
 * that appears or disappears is opened and closed in Chromium against the ui
 * Storybook (which also serves the video stories), and its animations are
 * read back frame by frame: token durations and easing, compositor-only
 * properties, in-between frames on entry and exit, opacity that never
 * flickers, an exit that stays visible until it has played, and the
 * reduced-motion fade.
 *
 * Components that mount with their story (the call stage, the stage's
 * failure overlay, the five-minute cue) are re-mounted from inside the page
 * with Storybook's `forceRemount` event, so their entry is recorded like any
 * other.
 *
 * The expert's outcome dialog has no story: it lives in `apps/admin` and is
 * the `@nestself/ui` Dialog (already covered in `popouts.motion.ts`). Its
 * entry and exit are recorded in the real admin app by the consultation
 * journey (`e2e/calls/consultation.spec.ts`).
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MIN_IN_BETWEEN_FRAMES, MOTION, animatedProperties, animationsSeen, gotoStory, isAtRest, isInBetween, recordFrames } from './motion-helpers';
import type { AnimationInfo, Frame } from './motion-helpers';

interface Phase {
  duration: number;
  properties: string[];
}

const FADE_AND_MOVE = ['opacity', 'transform'];
/** `dialog` and `popover` presets: in on the standard duration, out on the fast one. */
const DIALOG_IN: Phase = { duration: MOTION.standard, properties: FADE_AND_MOVE };
const DIALOG_OUT: Phase = { duration: MOTION.fast, properties: FADE_AND_MOVE };
const POPOVER_IN = DIALOG_IN;
const POPOVER_OUT = DIALOG_OUT;
/** `backdrop` preset: a standard fade both ways. */
const FADE: Phase = { duration: MOTION.standard, properties: ['opacity'] };
/** `sheet-*` presets: slow in, standard out, transform only. */
const SHEET_IN: Phase = { duration: MOTION.slow, properties: ['transform'] };
const SHEET_OUT: Phase = { duration: MOTION.standard, properties: ['transform'] };

const STAGE = 'section[aria-label="Video call"]';
const OLD = '[data-motion-old]';

const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

function expectTokenTiming(animations: AnimationInfo[], phase: Phase) {
  expect(animatedProperties(animations)).toEqual([...phase.properties].sort());
  for (const animation of animations) {
    expect(animation.kind, 'Motion hands these to the Web Animations API (compositor)').toBe('Animation');
    expect(animation.duration).toBe(phase.duration);
    expect(animation.easing).toBe(MOTION.easing);
  }
}

/** Opacity only moves one way during a phase: no flicker, no snap back. */
function expectMonotonicOpacity(frames: Frame[], direction: 'up' | 'down') {
  const values = frames.filter((frame) => frame.displayed).map((frame) => frame.opacity);
  for (let index = 1; index < values.length; index++) {
    if (direction === 'up') expect(values[index]!).toBeGreaterThanOrEqual(values[index - 1]! - 0.001);
    else expect(values[index]!).toBeLessThanOrEqual(values[index - 1]! + 0.001);
  }
}

function expectEntry(frames: Frame[], phase: Phase) {
  expectTokenTiming(animationsSeen(frames), phase);
  expect(frames.filter(isInBetween).length, 'in-between frames, not a jump').toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
  expectMonotonicOpacity(frames, 'up');
  expect(isAtRest(frames.at(-1)!), 'settles fully opaque at its resting position').toBe(true);
}

function expectExit(frames: Frame[], phase: Phase) {
  expectTokenTiming(animationsSeen(frames), phase);
  expect(frames.filter(isInBetween).length, 'the exit is seen, not an instant unmount').toBeGreaterThanOrEqual(2);
  expectMonotonicOpacity(frames, 'down');
  expect(frames.at(-1)!.displayed, 'leaves once the exit has played').toBe(false);
}

/**
 * Marks the elements on screen, so that a selector with
 * `:not([data-motion-old])` only ever sees an element mounted afterwards.
 * Called before the recording starts, so no frame samples the old element.
 */
async function markMounted(page: Page, selector: string): Promise<void> {
  await page.evaluate((selector) => {
    document.querySelectorAll(selector).forEach((element) => element.setAttribute('data-motion-old', ''));
  }, selector);
}

/** Re-mounts the story from inside the page (Storybook's `forceRemount`), without a reload. */
async function remount(page: Page, storyId: string): Promise<void> {
  await page.evaluate((storyId) => {
    (window as unknown as { __STORYBOOK_ADDONS_CHANNEL__: { emit: (event: string, payload: unknown) => void } }).__STORYBOOK_ADDONS_CHANNEL__.emit(
      'forceRemount',
      { storyId },
    );
  }, storyId);
}

/** Records the entry of `selector` as the story re-mounts. */
async function recordRemount(page: Page, storyId: string, selector: string): Promise<Frame[]> {
  await markMounted(page, selector);
  return recordFrames(page, `${selector}:not(${OLD})`, () => remount(page, storyId));
}

/**
 * Storybook's dev server reloads the page when a story's sources change
 * mid-run (other work in the same checkout). A reload resets the story and
 * the frame recorder, so a test where it happened is annotated: its failure
 * says nothing about the component.
 */
test.beforeEach(({ page }, testInfo) => {
  let loads = 0;
  page.on('load', () => {
    loads += 1;
    if (loads === 2) testInfo.annotations.push({ type: 'dev-server reload', description: 'The page reloaded during the test; rerun it.' });
  });
});

// ---------------------------------------------------------------------------
// PreJoinCheck: the panel enters and exits with the dialog preset
// ---------------------------------------------------------------------------

const PREJOIN_STORY = 'video-prejoincheck--default';
const PREJOIN = '#storybook-root section:has(> header)';
const hideCheck = (page: Page) => button(page, 'Hide the check (story only)').click();
const showCheck = (page: Page) => button(page, 'Show the check (story only)').click();

test.describe('PreJoinCheck panel', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStory(page, PREJOIN_STORY);
    await expect(page.locator(PREJOIN)).toBeVisible();
  });

  test('enters over several frames on the compositor with token timing', async ({ page }) => {
    await hideCheck(page);
    await expect(page.locator(PREJOIN)).toHaveCount(0);
    expectEntry(await recordFrames(page, PREJOIN, () => showCheck(page)), DIALOG_IN);
  });

  test('plays its exit while still visible, then leaves', async ({ page }) => {
    await page.waitForTimeout(500);
    expectExit(await recordFrames(page, PREJOIN, () => hideCheck(page)), DIALOG_OUT);
  });
});

// ---------------------------------------------------------------------------
// CallStage: the stage fades in; its overlays and the self-view pop in and out
// ---------------------------------------------------------------------------

test.describe('CallStage', () => {
  test('the stage fades in on the standard duration when it mounts', async ({ page }) => {
    const story = 'video-callstage--connected';
    await gotoStory(page, story);
    await expect(page.locator(STAGE)).toBeVisible();
    const frames = await recordRemount(page, story, STAGE);
    // The stage holds still (no transform): opacity is the whole movement.
    expectEntry(frames, FADE);
  });

  test('the failure overlay enters with the dialog preset', async ({ page }) => {
    const story = 'video-callstage--reconnect-failed';
    const overlay = `${STAGE} > div[role="alert"]`;
    await gotoStory(page, story);
    await expect(page.locator(overlay)).toBeVisible();
    // The stage itself fades in around it; the overlay's own animation is the dialog preset.
    expectEntry(await recordRemount(page, story, overlay), DIALOG_IN);
  });

  test('the failure overlay plays its exit when the call reconnects (Rejoin)', async ({ page }) => {
    const overlay = `${STAGE} > div[role="alert"]`;
    await gotoStory(page, 'video-callstage--reconnect-failed');
    await expect(page.locator(overlay)).toBeVisible();
    await page.waitForTimeout(500);
    expectExit(await recordFrames(page, overlay, () => button(page, 'Rejoin').click()), DIALOG_OUT);
  });

  test('"End for everyone" brings in the session-ended overlay', async ({ page }) => {
    const overlay = `${STAGE} > div[role="status"]`;
    await gotoStory(page, 'video-callstage--expert-view');
    await expect(page.locator(STAGE)).toBeVisible();
    await button(page, 'End for everyone').click();
    const confirm = button(page, 'End consultation');
    await expect(confirm).toBeVisible();
    await page.waitForTimeout(300);
    expectEntry(await recordFrames(page, overlay, () => confirm.click()), DIALOG_IN);
    await expect(page.locator(overlay)).toHaveText('The consultation has ended.');
  });

  test('the self-view pops out, and "Show your video" pops in after it', async ({ page }) => {
    const shown = '[data-testid="self-view"] > div.w-28';
    const hidden = '[data-testid="self-view"] > div:not(.w-28)';
    await gotoStory(page, 'video-callstage--connected');
    await expect(page.locator(shown)).toBeVisible();
    await page.waitForTimeout(500);

    const leaving = await recordFrames(page, shown, () => button(page, 'Hide your video').click());
    expectExit(leaving, POPOVER_OUT);

    // `mode="wait"`: the button enters only once the video has left.
    await button(page, 'Show your video').waitFor();
    await page.waitForTimeout(300);
    const returning = await recordFrames(page, shown, () => button(page, 'Show your video').click());
    expectEntry(returning, POPOVER_IN);
    await expect(page.locator(hidden)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// ControlBar: the overflow menu below 72rem
// ---------------------------------------------------------------------------

test.describe('ControlBar overflow menu', () => {
  // "More" only exists below `CONTROL_BAR_WIDE_QUERY` (72rem).
  test.use({ viewport: { width: 390, height: 844 } });
  const MENU = '[role="menu"]';

  test.beforeEach(async ({ page }) => {
    await gotoStory(page, 'video-controlbar--employee');
    await expect(button(page, 'More')).toBeVisible();
  });

  test('opens over several frames on the compositor with token timing', async ({ page }) => {
    expectEntry(await recordFrames(page, MENU, () => button(page, 'More').click()), POPOVER_IN);
    await expect(page.getByRole('menuitem', { name: 'I cannot hear you' })).toBeVisible();
  });

  test('plays its exit while still visible, then leaves', async ({ page }) => {
    await button(page, 'More').click();
    await expect(page.locator(MENU)).toBeVisible();
    await page.waitForTimeout(500);
    expectExit(await recordFrames(page, MENU, () => page.keyboard.press('Escape')), POPOVER_OUT);
  });
});

// ---------------------------------------------------------------------------
// SessionTimer: the dismissable five-minute cue
// ---------------------------------------------------------------------------

const CUE_STORY = 'video-sessiontimer--five-minutes-left';
const CUE = '#storybook-root .bg-warning-surface';

test.describe('SessionTimer five-minute cue', () => {
  test.beforeEach(async ({ page }) => {
    await gotoStory(page, CUE_STORY);
    await expect(page.locator(CUE)).toContainText('Five minutes left.');
  });

  test('enters over several frames on the compositor with token timing', async ({ page }) => {
    expectEntry(await recordRemount(page, CUE_STORY, CUE), POPOVER_IN);
  });

  test('plays its exit when dismissed, then leaves', async ({ page }) => {
    await page.waitForTimeout(500);
    expectExit(await recordFrames(page, CUE, () => button(page, 'Dismiss').click()), POPOVER_OUT);
  });
});

// ---------------------------------------------------------------------------
// CrisisBlock: the in-call crisis resources sheet and the expert's drawer
// ---------------------------------------------------------------------------

const SHEET = '[role="dialog"]';
const SCRIM = '.bg-scrim';
const openCrisis = (page: Page) => button(page, 'Crisis resources').click();
const closeCrisis = (page: Page) => page.keyboard.press('Escape');

for (const sheet of [
  { name: 'employee bottom sheet', story: 'video-crisisblock--in-call-sheet' },
  { name: 'expert right drawer', story: 'video-crisisblock--in-call-sheet-expert' },
]) {
  test.describe(`CrisisBlock ${sheet.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await gotoStory(page, sheet.story);
    });

    test('slides in on the slow duration, on the compositor', async ({ page }) => {
      expectEntry(await recordFrames(page, SHEET, () => openCrisis(page)), SHEET_IN);
      await expect(page.getByRole('dialog', { name: 'Need urgent help?' })).toBeVisible();
    });

    test('slides out while still visible, then leaves', async ({ page }) => {
      await openCrisis(page);
      await expect(page.locator(SHEET)).toBeVisible();
      await page.waitForTimeout(500);
      expectExit(await recordFrames(page, SHEET, () => closeCrisis(page)), SHEET_OUT);
    });

    test('fades its scrim in and out', async ({ page }) => {
      const opening = await recordFrames(page, SCRIM, () => openCrisis(page));
      expectTokenTiming(animationsSeen(opening), FADE);
      expect(opening.filter(isInBetween).length).toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
      const closing = await recordFrames(page, SCRIM, () => closeCrisis(page));
      expectTokenTiming(animationsSeen(closing), FADE);
      expect(closing.filter(isInBetween).length).toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
      expect(closing.at(-1)!.displayed).toBe(false);
    });
  });
}

// ---------------------------------------------------------------------------
// FollowUpCard: the card arrives and leaves; the employee's suggestion form expands
// ---------------------------------------------------------------------------

const CARD = '#storybook-root section[aria-labelledby]';
const proposalArrives = (page: Page) => button(page, 'A proposal arrives (story only)').click();
const proposalRemoved = (page: Page) => button(page, 'Remove the proposal (story only)').click();

test.describe('FollowUpCard', () => {
  test('enters when a proposal arrives', async ({ page }) => {
    await gotoStory(page, 'video-followupcard--proposal-arrives');
    await expect(page.locator(CARD)).toHaveCount(0);
    expectEntry(await recordFrames(page, CARD, () => proposalArrives(page)), DIALOG_IN);
    await expect(page.getByRole('heading', { name: 'Your expert proposed a follow-up' })).toBeVisible();
  });

  test('plays its exit while still visible when the proposal goes, then leaves', async ({ page }) => {
    await gotoStory(page, 'video-followupcard--proposal-arrives');
    await proposalArrives(page);
    await expect(page.locator(CARD)).toBeVisible();
    await page.waitForTimeout(500);
    expectExit(await recordFrames(page, CARD, () => proposalRemoved(page)), DIALOG_OUT);
  });

  test('"Suggest other times" expands frame by frame and collapses out of the layout', async ({ page }) => {
    await gotoStory(page, 'video-followupcard--employee-proposal');
    const toggle = button(page, 'Suggest other times');
    const panel = `${CARD} div.overflow-hidden:has(form)`;

    const opening = await recordFrames(page, panel, () => toggle.click(), 600);
    // Height is the one layout property a disclosure animates (Motion runs it on the main thread);
    // its fade goes through the Web Animations API on the token timing.
    const fadeIn = animationsSeen(opening).filter((animation) => animation.properties.includes('opacity'));
    expect(fadeIn.length).toBeGreaterThan(0);
    for (const animation of fadeIn) {
      expect(animation.duration).toBe(MOTION.standard);
      expect(animation.easing).toBe(MOTION.easing);
    }
    const final = opening.at(-1)!.height;
    expect(final).toBeGreaterThan(100);
    const rising = opening.filter((frame) => frame.displayed).map((frame) => frame.height);
    expect(rising.filter((height) => height > 1 && height < final - 1).length, 'grows, does not jump').toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
    expect(rising.every((height, index) => index === 0 || height >= rising[index - 1]! - 0.5)).toBe(true);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    await page.waitForTimeout(300);
    const closing = await recordFrames(page, panel, () => toggle.click(), 600);
    const fadeOut = animationsSeen(closing).filter((animation) => animation.properties.includes('opacity'));
    for (const animation of fadeOut) expect(animation.duration).toBe(MOTION.fast);
    const falling = closing.filter((frame) => frame.displayed).map((frame) => frame.height);
    expect(falling.filter((height) => height > 1 && height < final - 1).length, 'shrinks, does not vanish').toBeGreaterThanOrEqual(2);
    expect(closing.at(-1)!.present, 'unmounted once collapsed').toBe(false);
  });
});

// ---------------------------------------------------------------------------
// ConnectionBadge: the explanatory banner
// ---------------------------------------------------------------------------

test.describe('ConnectionBadge banner', () => {
  const BANNER = '#storybook-root p.origin-top-left';

  test.beforeEach(async ({ page }) => {
    await gotoStory(page, 'video-connectionbadge--transitions');
    await expect(page.locator(BANNER)).toHaveCount(0);
  });

  test('enters when the connection degrades', async ({ page }) => {
    expectEntry(await recordFrames(page, BANNER, () => button(page, 'Degraded').click()), POPOVER_IN);
    await expect(page.getByTestId('connection-badge')).toHaveAttribute('data-quality', 'degraded');
  });

  test('plays its exit when the connection recovers, then leaves', async ({ page }) => {
    await button(page, 'Degraded').click();
    await expect(page.locator(BANNER)).toBeVisible();
    await page.waitForTimeout(500);
    expectExit(await recordFrames(page, BANNER, () => button(page, 'Good').click()), POPOVER_OUT);
  });
});

// ---------------------------------------------------------------------------
// Reduced motion: a short fade with no movement
// ---------------------------------------------------------------------------

interface ReducedCase {
  name: string;
  story: string;
  selector: string;
  viewport?: { width: number; height: number };
  /** Puts the story in the state just before the element appears. */
  prepare?: (page: Page) => Promise<void>;
  appear: (page: Page) => Promise<unknown>;
}

const reducedCases: ReducedCase[] = [
  {
    name: 'PreJoinCheck panel',
    story: PREJOIN_STORY,
    selector: PREJOIN,
    prepare: async (page) => {
      await hideCheck(page);
      await expect(page.locator(PREJOIN)).toHaveCount(0);
    },
    appear: showCheck,
  },
  { name: 'CrisisBlock sheet', story: 'video-crisisblock--in-call-sheet', selector: SHEET, appear: openCrisis },
  {
    name: 'ControlBar overflow menu',
    story: 'video-controlbar--employee',
    selector: '[role="menu"]',
    viewport: { width: 390, height: 844 },
    appear: (page) => button(page, 'More').click(),
  },
  {
    name: 'SessionTimer five-minute cue',
    story: CUE_STORY,
    selector: `${CUE}:not(${OLD})`,
    prepare: async (page) => {
      await expect(page.locator(CUE)).toBeVisible();
      await markMounted(page, CUE);
    },
    appear: (page) => remount(page, CUE_STORY),
  },
  { name: 'FollowUpCard', story: 'video-followupcard--proposal-arrives', selector: CARD, appear: proposalArrives },
  {
    name: 'ConnectionBadge banner',
    story: 'video-connectionbadge--transitions',
    selector: '#storybook-root p.origin-top-left',
    appear: (page) => button(page, 'Degraded').click(),
  },
];

test.describe('reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  for (const item of reducedCases) {
    test(`${item.name}: a short fade with no movement`, async ({ page }) => {
      if (item.viewport) await page.setViewportSize(item.viewport);
      await gotoStory(page, item.story);
      await item.prepare?.(page);
      const frames = await recordFrames(page, item.selector, () => item.appear(page));
      const seen = animationsSeen(frames);
      expect(animatedProperties(seen)).toEqual(['opacity']);
      for (const animation of seen) expect(animation.duration).toBeLessThanOrEqual(MOTION.reducedFadeMax);
      for (const frame of frames.filter((f) => f.displayed)) expect(frame.transform).toBe('none');
      expect(frames.at(-1)!.displayed).toBe(true);
      expect(frames.at(-1)!.opacity).toBe(1);
    });
  }

  test('CrisisBlock sheet: the exit is the same short fade', async ({ page }) => {
    await gotoStory(page, 'video-crisisblock--in-call-sheet');
    await openCrisis(page);
    await expect(page.locator(SHEET)).toBeVisible();
    await page.waitForTimeout(300);
    const frames = await recordFrames(page, SHEET, () => closeCrisis(page));
    const seen = animationsSeen(frames);
    expect(animatedProperties(seen)).toEqual(['opacity']);
    for (const animation of seen) expect(animation.duration).toBeLessThanOrEqual(MOTION.reducedFadeMax);
    expect(frames.at(-1)!.displayed).toBe(false);
  });
});
