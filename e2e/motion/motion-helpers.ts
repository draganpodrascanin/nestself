import type { Locator, Page } from '@playwright/test';

/** Token timings (packages/tokens/tokens.json `primitive.motion`). */
export const MOTION = {
  fast: 120,
  standard: 200,
  slow: 280,
  reducedFadeMax: 50,
  easing: 'cubic-bezier(0.2, 0, 0, 1)',
} as const;

/**
 * In-between frames a transition must show to count as animated rather than
 * a jump. The recorder samples on the main thread, which a busy machine can
 * starve while React mounts the popup (the compositor animation itself keeps
 * its frames), so the floor is two rather than the eight or so seen at rest.
 */
export const MIN_IN_BETWEEN_FRAMES = 2;

/** Properties the compositor can animate without layout or paint. */
export const COMPOSITOR_PROPERTIES = ['opacity', 'transform'];

export interface AnimationInfo {
  kind: string;
  properties: string[];
  duration: number;
  easing: string;
  playState: string;
}

/** Open a story in the bare Storybook iframe and wait for it to render. */
export async function gotoStory(page: Page, id: string): Promise<void> {
  await page.goto(`/iframe.html?id=${id}&viewMode=story`);
  await page.locator('#storybook-root > *').first().waitFor();
}

/** Animations currently attached to the element (CSS transitions and WAAPI). */
export function animationsOf(locator: Locator): Promise<AnimationInfo[]> {
  return locator.evaluate((element) =>
    element.getAnimations().map((animation) => {
      const effect = animation.effect as KeyframeEffect;
      const timing = effect.getTiming();
      const properties =
        animation instanceof CSSTransition
          ? [animation.transitionProperty]
          : [
              ...new Set(
                effect
                  .getKeyframes()
                  .flatMap((keyframe) => Object.keys(keyframe))
                  .filter((key) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key)),
              ),
            ];
      return {
        kind: animation.constructor.name,
        properties,
        duration: Number(timing.duration),
        easing: String(timing.easing),
        playState: animation.playState,
      };
    }),
  );
}

/** Every animated property across the element's running animations. */
export function animatedProperties(animations: AnimationInfo[]): string[] {
  return [...new Set(animations.flatMap((animation) => animation.properties))].sort();
}

/** Computed opacity and transform, for mid-animation checks. */
export function visualState(locator: Locator): Promise<{ opacity: number; transform: string }> {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    return { opacity: Number(style.opacity), transform: style.transform };
  });
}

export interface Frame {
  /** Milliseconds since recording started. */
  t: number;
  present: boolean;
  /** Rendered: in the DOM, not `hidden`, not `display: none`. */
  displayed: boolean;
  opacity: number;
  transform: string;
  height: number;
  x: number;
  width: number;
  animations: AnimationInfo[];
}

/**
 * Record the element matched by `selector` on every animation frame while
 * `action` runs and for `durationMs` afterwards. Frames are what the person
 * sees, so "smooth" becomes: several in-between frames, no jumps.
 */
export async function recordFrames(
  page: Page,
  selector: string,
  action: () => Promise<unknown>,
  durationMs = 900,
): Promise<Frame[]> {
  await page.evaluate(
    ({ selector, durationMs }) => {
      const frames: unknown[] = [];
      (window as unknown as { __frames: unknown[] }).__frames = frames;
      const start = performance.now();
      const tick = () => {
        const element = document.querySelector<HTMLElement>(selector);
        const t = performance.now() - start;
        if (!element) {
          frames.push({ t, present: false, displayed: false, opacity: 0, transform: 'none', height: 0, x: 0, width: 0, animations: [] });
        } else {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          frames.push({
            t,
            present: true,
            displayed: !element.hidden && style.display !== 'none' && !element.closest('[hidden]'),
            opacity: Number(style.opacity),
            transform: style.transform,
            height: box.height,
            x: box.x,
            width: box.width,
            animations: element.getAnimations().map((animation) => {
              const effect = animation.effect as KeyframeEffect;
              const timing = effect.getTiming();
              return {
                kind: animation.constructor.name,
                properties:
                  animation instanceof CSSTransition
                    ? [animation.transitionProperty]
                    : [
                        ...new Set(
                          effect
                            .getKeyframes()
                            .flatMap((keyframe) => Object.keys(keyframe))
                            .filter((key) => !['offset', 'easing', 'composite', 'computedOffset'].includes(key)),
                        ),
                      ],
                duration: Number(timing.duration),
                easing: String(timing.easing),
                playState: animation.playState,
              };
            }),
          });
        }
        if (t < durationMs) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    { selector, durationMs },
  );
  await action();
  await page.waitForFunction(
    (durationMs) => {
      const frames = (window as unknown as { __frames: Array<{ t: number }> }).__frames;
      return frames.length > 0 && frames[frames.length - 1]!.t >= durationMs;
    },
    durationMs,
    { timeout: durationMs + 5_000 },
  );
  return page.evaluate(() => (window as unknown as { __frames: Frame[] }).__frames);
}

const IDENTITY = new Set(['none', 'matrix(1, 0, 0, 1, 0, 0)']);

/** A frame the person sees between the start and rest states. */
export function isInBetween(frame: Frame): boolean {
  if (!frame.displayed) return false;
  return (frame.opacity > 0.02 && frame.opacity < 0.98) || !IDENTITY.has(frame.transform);
}

export function isAtRest(frame: Frame): boolean {
  return frame.displayed && frame.opacity === 1 && IDENTITY.has(frame.transform);
}

/** Every animation seen across the frames, deduplicated. */
export function animationsSeen(frames: Frame[]): AnimationInfo[] {
  const seen = new Map<string, AnimationInfo>();
  for (const frame of frames) {
    for (const animation of frame.animations) {
      seen.set(`${animation.properties.join('+')}:${animation.duration}:${animation.easing}`, animation);
    }
  }
  return [...seen.values()];
}
