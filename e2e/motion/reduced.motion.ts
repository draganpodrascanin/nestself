import { expect, test } from '@playwright/test';
import { MOTION, animatedProperties, animationsOf, animationsSeen, gotoStory, recordFrames } from './motion-helpers';

test.use({ reducedMotion: 'reduce' });

const cases = [
  { name: 'dialog', story: 'dialogs-dialog--states', trigger: 'Open Dialog', selector: '[role="dialog"]' },
  { name: 'right drawer', story: 'dialogs-sheet--drawer-right', trigger: 'Open right drawer', selector: '[role="dialog"]' },
  { name: 'menu', story: 'navigation-menu--states', trigger: 'Options', selector: '[role="menu"]' },
] as const;

for (const item of cases) {
  test(`${item.name}: reduced motion is a short fade with no movement`, async ({ page }) => {
    await gotoStory(page, item.story);
    const frames = await recordFrames(page, item.selector, () =>
      page.getByRole('button', { name: item.trigger, exact: true }).click(),
    );
    const seen = animationsSeen(frames);
    expect(animatedProperties(seen)).toEqual(['opacity']);
    for (const animation of seen) expect(animation.duration).toBeLessThanOrEqual(MOTION.reducedFadeMax);
    for (const frame of frames.filter((f) => f.displayed)) expect(frame.transform).toBe('none');
  });
}

test('accordion: reduced motion opens the panel instantly', async ({ page }) => {
  await gotoStory(page, 'navigation-accordion--faq');
  const trigger = page.getByRole('button', { name: 'How do I access the platform?' });
  await trigger.click();
  const panel = page.locator(`[role="region"][aria-labelledby="${await trigger.getAttribute('id')}"]`);
  await expect(panel).toBeVisible();
  expect(await animationsOf(panel)).toEqual([]);
});
