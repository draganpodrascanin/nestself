/**
 * Session lifetime resolution per population and context.
 *
 * @see 3.6.4 Session lifetimes, SESS-R-13
 */
import { z } from 'zod';
import type { Population, ActiveContext } from '@nestself/contracts';

export interface SessionLifetimes {
  /** Idle timeout in seconds. */
  idleSeconds: number;
  /** Absolute session lifetime in seconds. */
  absoluteSeconds: number;
}

/**
 * Default lifetime table from 3.6.4.
 *
 * Keys: `{population}:{contextKind}`
 */
const DEFAULTS: Record<string, SessionLifetimes> = {
  // Employee, personal context
  'employee:personal':        { idleSeconds: 1_800,     absoluteSeconds: 43_200 },
  // Employee, organization context
  'employee:organization':    { idleSeconds: 3_600,     absoluteSeconds: 28_800 },
  // Employer owner / HR administrator / employer finance
  'employer_admin:personal':      { idleSeconds: 3_600, absoluteSeconds: 28_800 },
  'employer_admin:organization':  { idleSeconds: 3_600, absoluteSeconds: 28_800 },
  // Expert
  'expert:personal':          { idleSeconds: 28_800,    absoluteSeconds: 604_800 },
  'expert:expert':            { idleSeconds: 28_800,    absoluteSeconds: 604_800 },
  // Staff (operations, content, coordinators, support, finance, platform owner)
  'staff:personal':           { idleSeconds: 3_600,     absoluteSeconds: 28_800 },
  'staff:operations':         { idleSeconds: 3_600,     absoluteSeconds: 28_800 },
  // External (same as employee personal)
  'external:personal':        { idleSeconds: 1_800,     absoluteSeconds: 43_200 },
};

/** Remember-device idle override: 30 days for employee personal only. */
const REMEMBER_DEVICE_IDLE = 2_592_000; // 30 days

/** Default fallback when no matching entry exists. */
const FALLBACK: SessionLifetimes = { idleSeconds: 1_800, absoluteSeconds: 28_800 };

/** Hard caps for overrides (security review Fix 5). */
const MAX_IDLE_SECONDS = 2_592_000;    // 30 days
const MAX_ABSOLUTE_SECONDS = 7_776_000; // 90 days

const OverridesSchema = z.record(
  z.string(),
  z.object({
    idleSeconds: z.number().int().positive(),
    absoluteSeconds: z.number().int().positive(),
  }),
);

let parsedOverrides: Record<string, SessionLifetimes> | null = null;

function loadOverrides(json: string | undefined): Record<string, SessionLifetimes> {
  if (!json) return {};
  if (parsedOverrides !== null) return parsedOverrides;
  const raw = OverridesSchema.parse(JSON.parse(json));
  // Validate caps
  for (const [key, val] of Object.entries(raw)) {
    if (val.idleSeconds > MAX_IDLE_SECONDS) {
      throw new Error(
        `SESSION_LIFETIME_OVERRIDES: "${key}" idleSeconds (${val.idleSeconds}) exceeds the 30-day cap (${MAX_IDLE_SECONDS})`,
      );
    }
    if (val.absoluteSeconds > MAX_ABSOLUTE_SECONDS) {
      throw new Error(
        `SESSION_LIFETIME_OVERRIDES: "${key}" absoluteSeconds (${val.absoluteSeconds}) exceeds the 90-day cap (${MAX_ABSOLUTE_SECONDS})`,
      );
    }
    if (val.idleSeconds > val.absoluteSeconds) {
      throw new Error(
        `SESSION_LIFETIME_OVERRIDES: "${key}" idleSeconds (${val.idleSeconds}) must not exceed absoluteSeconds (${val.absoluteSeconds})`,
      );
    }
  }
  parsedOverrides = raw;
  return parsedOverrides;
}

/**
 * Resolve idle and absolute lifetimes for a session.
 *
 * @see SESS-R-13 — configurable per environment
 */
export function resolveLifetimes(
  population: Population,
  context: ActiveContext,
  rememberDevice: boolean,
  overridesJson?: string,
): SessionLifetimes {
  const key = `${population}:${context.kind}`;
  const overrides = loadOverrides(overridesJson);
  const base = overrides[key] ?? DEFAULTS[key] ?? FALLBACK;

  if (rememberDevice && population === 'employee' && context.kind === 'personal') {
    return { idleSeconds: REMEMBER_DEVICE_IDLE, absoluteSeconds: base.absoluteSeconds };
  }

  return base;
}

/** Reset cached overrides (for testing). */
export function resetOverridesCache(): void {
  parsedOverrides = null;
}
