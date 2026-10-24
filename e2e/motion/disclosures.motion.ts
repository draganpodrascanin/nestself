import { expect, test } from '@playwright/test';
import { MIN_IN_BETWEEN_FRAMES, MOTION, animatedProperties, animationsOf, animationsSeen, gotoStory, recordFrames } from './motion-helpers';

test.describe('accordion', () => {
  test('panels expand and collapse frame by frame on the measured height', async ({ page }) => {
    await gotoStory(page, 'navigation-accordion--faq');
    const trigger = page.getByRole('button', { name: 'How do I access the platform?' });
    // Base UI only sets aria-controls once the panel exists, so find it by its label.
    const selector = `[role="region"][aria-labelledby="${await trigger.getAttribute('id')}"]`;

    const opening = await recordFrames(page, selector, () => trigger.click(), 600);
    const seen = animationsSeen(opening);
    expect(animatedProperties(seen)).toEqual(['height', 'opacity']);
    for (const transition of seen) {
      expect(transition.kind).toBe('CSSTransition');
      expect(transition.duration).toBe(MOTION.standard);
      expect(transition.easing).toBe(MOTION.easing);
    }
    const final = opening.at(-1)!.height;
    const rising = opening.filter((frame) => frame.displayed).map((frame) => frame.height);
    expect(rising.filter((height) => height > 1 && height < final - 1).length).toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
    expect(rising.every((height, index) => index === 0 || height >= rising[index - 1]! - 0.5)).toBe(true);

    const closing = await recordFrames(page, selector, () => trigger.click(), 600);
    const falling = closing.filter((frame) => frame.displayed).map((frame) => frame.height);
    expect(falling.filter((height) => height > 1 && height < final - 1).length).toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
    expect(closing.at(-1)!.displayed).toBe(false);
  });
});

test.describe('tabs', () => {
  test('the indicator slides to the selected tab and lands on it', async ({ page }) => {
    await gotoStory(page, 'navigation-tabs--states');
    const target = page.getByRole('tab', { name: 'Settings' });
    const frames = await recordFrames(page, '[role="tablist"] > span', () => target.click(), 500);
    const seen = animationsSeen(frames);
    expect(animatedProperties(seen)).toEqual(['translate', 'width']);
    for (const transition of seen) {
      expect(transition.duration).toBe(MOTION.standard);
      expect(transition.easing).toBe(MOTION.easing);
    }
    const tab = (await target.boundingBox())!;
    const xs = frames.map((frame) => frame.x);
    expect(xs.filter((x) => Math.abs(x - xs[0]!) > 1 && Math.abs(x - tab.x) > 1).length, 'slides, does not jump').toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
    expect(Math.abs(frames.at(-1)!.x - tab.x)).toBeLessThan(1);
    expect(Math.abs(frames.at(-1)!.width - tab.width)).toBeLessThan(1);
  });
});

test.describe('site header navigation (compact)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('expands frame by frame, collapses, and leaves no hidden links behind', async ({ page }) => {
    await gotoStory(page, 'navigation-siteheader--states');
    const toggle = page.locator('button[aria-controls="site-nav"]');
    const row = page.locator('#site-nav').locator('..');
    const firstLink = page.locator('#site-nav a').first();
    await expect(firstLink).toBeHidden();
    const headerHeight = await page.locator('header').evaluate((header) => header.getBoundingClientRect().height);

    // Record the row height on every frame while it opens.
    await page.evaluate(() => {
      const element = document.getElementById('site-nav')!.parentElement!;
      const heights: number[] = [];
      (window as unknown as { heights: number[] }).heights = heights;
      const start = performance.now();
      const tick = () => {
        heights.push(element.getBoundingClientRect().height);
        if (performance.now() - start < 600) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await toggle.click();
    const opacity = await animationsOf(row);
    expect(opacity.map((animation) => [animation.properties, animation.duration])).toContainEqual([['opacity'], MOTION.standard]);
    await page.waitForTimeout(700);
    const heights = await page.evaluate(() => (window as unknown as { heights: number[] }).heights);
    const final = heights.at(-1)!;
    const between = heights.filter((height) => height > 1 && height < final - 1);
    expect(final).toBeGreaterThan(100);
    expect(between.length, 'several in-between frames, not a jump').toBeGreaterThanOrEqual(MIN_IN_BETWEEN_FRAMES);
    expect(heights.every((height, index) => index === 0 || height >= heights[index - 1]! - 0.5)).toBe(true);
    await expect(firstLink).toBeVisible();

    await toggle.click();
    await expect(firstLink).toBeHidden();
    await expect.poll(() => row.evaluate((element) => getComputedStyle(element).display)).toBe('none');
    expect(await page.locator('header').evaluate((header) => header.getBoundingClientRect().height)).toBe(headerHeight);
  });

  test('the desktop navigation is not affected by the compact row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await gotoStory(page, 'navigation-siteheader--states');
    await expect(page.locator('#site-nav a').first()).toBeVisible();
    expect(await page.locator('#site-nav').locator('..').evaluate((element) => getComputedStyle(element).display)).toBe('contents');
  });
});
