import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { MIN_IN_BETWEEN_FRAMES, MOTION, animatedProperties, animationsSeen, gotoStory, isAtRest, isInBetween, recordFrames } from './motion-helpers';
import type { AnimationInfo, Frame } from './motion-helpers';

interface Phase {
  duration: number;
  properties: string[];
}

interface PopoutCase {
  name: string;
  story: string;
  /** CSS selector for the animated popup element. */
  selector: string;
  open: (page: Page) => Promise<void>;
  close: (page: Page) => Promise<void>;
  enter: Phase;
  exit: Phase;
  /** Dialogs and sheets fade a scrim in and out with the standard duration. */
  backdrop?: boolean;
}

const escape = (page: Page) => page.keyboard.press('Escape');
const button = (name: string) => (page: Page) => page.getByRole('button', { name, exact: true }).click();
const SCALE_AND_FADE = ['opacity', 'transform'];

const cases: PopoutCase[] = [
  {
    name: 'dialog',
    story: 'dialogs-dialog--states',
    selector: '[role="dialog"]',
    open: button('Open Dialog'),
    close: escape,
    enter: { duration: MOTION.standard, properties: SCALE_AND_FADE },
    exit: { duration: MOTION.fast, properties: SCALE_AND_FADE },
    backdrop: true,
  },
  {
    name: 'alert dialog',
    story: 'dialogs-alertdialog--states',
    selector: '[role="alertdialog"]',
    open: button('Cancel appointment'),
    close: button('Keep it'),
    enter: { duration: MOTION.standard, properties: SCALE_AND_FADE },
    exit: { duration: MOTION.fast, properties: SCALE_AND_FADE },
    backdrop: true,
  },
  {
    name: 'bottom sheet',
    story: 'dialogs-sheet--states',
    selector: '[role="dialog"]',
    open: button('Open Sheet'),
    close: escape,
    enter: { duration: MOTION.slow, properties: ['transform'] },
    exit: { duration: MOTION.standard, properties: ['transform'] },
    backdrop: true,
  },
  {
    name: 'left drawer',
    story: 'dialogs-sheet--drawer-left',
    selector: '[role="dialog"]',
    open: button('Open left drawer'),
    close: escape,
    enter: { duration: MOTION.slow, properties: ['transform'] },
    exit: { duration: MOTION.standard, properties: ['transform'] },
    backdrop: true,
  },
  {
    name: 'right drawer',
    story: 'dialogs-sheet--drawer-right',
    selector: '[role="dialog"]',
    open: button('Open right drawer'),
    close: escape,
    enter: { duration: MOTION.slow, properties: ['transform'] },
    exit: { duration: MOTION.standard, properties: ['transform'] },
    backdrop: true,
  },
  {
    name: 'menu',
    story: 'navigation-menu--states',
    selector: '[role="menu"]',
    open: button('Options'),
    close: escape,
    enter: { duration: MOTION.standard, properties: SCALE_AND_FADE },
    exit: { duration: MOTION.fast, properties: SCALE_AND_FADE },
  },
  {
    name: 'select',
    story: 'fields-field--select-default',
    selector: '[role="listbox"]',
    open: (page) => page.getByRole('combobox').click(),
    close: escape,
    enter: { duration: MOTION.standard, properties: SCALE_AND_FADE },
    exit: { duration: MOTION.fast, properties: SCALE_AND_FADE },
  },
  {
    name: 'toast',
    story: 'feedback-toast--states',
    selector: '[aria-label="Notifications"] [role="dialog"]',
    open: button('Show Info Toast'),
    close: (page) => page.getByLabel('Dismiss').click(),
    // y and scale run on the main thread under layout projection; opacity stays on the compositor.
    enter: { duration: MOTION.standard, properties: ['opacity'] },
    exit: { duration: MOTION.fast, properties: ['opacity'] },
  },
];

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

for (const popout of cases) {
  test.describe(popout.name, () => {
    test.beforeEach(async ({ page }) => {
      await gotoStory(page, popout.story);
    });

    test('enters over several frames on the compositor with token timing', async ({ page }) => {
      const frames = await recordFrames(page, popout.selector, () => popout.open(page));
      expectTokenTiming(animationsSeen(frames), popout.enter);
      expect(frames.filter(isInBetween).length, 'in-between frames, not a jump').toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
      expectMonotonicOpacity(frames, 'up');
      expect(isAtRest(frames.at(-1)!), 'settles fully opaque at its resting position').toBe(true);
    });

    test('plays its exit while still visible, then leaves', async ({ page }) => {
      await popout.open(page);
      await expect(page.locator(popout.selector)).toBeVisible();
      await page.waitForTimeout(500);

      const frames = await recordFrames(page, popout.selector, () => popout.close(page));
      expectTokenTiming(animationsSeen(frames), popout.exit);
      expect(frames.filter(isInBetween).length, 'the exit is seen, not an instant unmount').toBeGreaterThanOrEqual(2);
      expectMonotonicOpacity(frames, 'down');
      expect(frames.at(-1)!.displayed).toBe(false);
    });

    if (popout.backdrop) {
      test('fades its scrim in and out', async ({ page }) => {
        const opening = await recordFrames(page, '.bg-scrim', () => popout.open(page));
        expectTokenTiming(animationsSeen(opening), { duration: MOTION.standard, properties: ['opacity'] });
        expect(opening.filter(isInBetween).length).toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
        const closing = await recordFrames(page, '.bg-scrim', () => popout.close(page));
        expectTokenTiming(animationsSeen(closing), { duration: MOTION.standard, properties: ['opacity'] });
        expect(closing.filter(isInBetween).length).toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
        expect(closing.at(-1)!.displayed).toBe(false);
      });
    }
  });
}

test('a menu closed mid-entry turns around from where it was, then reopens', async ({ page }) => {
  await gotoStory(page, 'navigation-menu--states');
  const trigger = page.getByRole('button', { name: 'Options', exact: true });
  // Press Escape from inside the page on the first frame the menu is partly
  // visible, so the interruption never races the 200 ms entry.
  await page.evaluate(() => {
    const tick = () => {
      const menu = document.querySelector('[role="menu"]');
      if (menu && Number(getComputedStyle(menu).opacity) > 0.2) {
        (document.activeElement ?? document.body).dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const frames = await recordFrames(page, '[role="menu"]', () => trigger.click());
  const opacities = frames.filter((frame) => frame.displayed).map((frame) => frame.opacity);
  const peak = opacities.indexOf(Math.max(...opacities));
  expect(Math.max(...opacities), 'closed before it finished opening').toBeLessThan(0.99);
  // Up to the turning point, then only down: no snap to fully open before the exit.
  expectMonotonicOpacity(frames.slice(0, frames.findIndex((frame) => frame.displayed) + peak + 1), 'up');
  expectMonotonicOpacity(frames.slice(frames.findIndex((frame) => frame.displayed) + peak), 'down');
  expect(frames.at(-1)!.displayed).toBe(false);

  await trigger.click();
  await expect(page.getByRole('menuitem').first()).toBeVisible();
});
