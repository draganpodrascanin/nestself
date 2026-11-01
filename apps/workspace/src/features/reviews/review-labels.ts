/**
 * Shared labels and tones of the workplace review screens. A status always
 * travels with its text; a price is shown only from catalogue or quote data,
 * never computed; people are first names and functions.
 */
import type { ImprovementActionStatus, ReviewEngagementStatus, ReviewRequestStatus, ReviewScopeStatus, ReviewScopeView, ReviewServiceView } from '@nestself/contracts';
import { formatCurrency } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import type { BadgeTone } from '@nestself/ui';

export const REQUEST_TONE: Record<ReviewRequestStatus, BadgeTone> = {
  submitted: 'info',
  needs_information: 'warning',
  in_review: 'info',
  scoped: 'warning',
  converted: 'success',
  declined: 'neutral',
  canceled: 'neutral',
};

export const ENGAGEMENT_TONE: Record<ReviewEngagementStatus, BadgeTone> = {
  accepted: 'info',
  scheduled: 'info',
  in_progress: 'info',
  report_shared: 'success',
  follow_up: 'warning',
  completed: 'success',
  canceled: 'neutral',
};

export const SCOPE_TONE: Record<ReviewScopeStatus, BadgeTone> = {
  draft: 'neutral',
  sent: 'warning',
  accepted: 'success',
  rejected: 'neutral',
  expired: 'neutral',
  superseded: 'neutral',
};

export const ACTION_TONE: Record<ImprovementActionStatus, BadgeTone> = {
  proposed: 'info',
  agreed: 'warning',
  in_progress: 'info',
  completed: 'success',
  not_proceeding: 'neutral',
};

export const requestStatusKey = (s: ReviewRequestStatus) => `listening:reviews.status.request.${s}` as const;
export const engagementStatusKey = (s: ReviewEngagementStatus) => `listening:reviews.status.engagement.${s}` as const;
export const scopeStatusKey = (s: ReviewScopeStatus) => `listening:reviews.status.scope.${s}` as const;
export const actionStatusKey = (s: ImprovementActionStatus) => `listening:reviews.status.action.${s}` as const;

/** The price of a scope or service, from its own data: a quote label, "Free", or the formatted amount. */
export function priceLabel(
  t: (key: string, opts?: Record<string, unknown>) => string,
  item: Pick<ReviewScopeView, 'priceMinor' | 'currency'> | Pick<ReviewServiceView, 'priceMinor' | 'currency'>,
  locale: Locale,
): string {
  if (item.priceMinor === null) return t('listening:reviews.pricing.quote');
  if (item.priceMinor === 0) return t('listening:reviews.pricing.free');
  const currency = item.currency === 'RSD' ? 'RSD' : 'EUR';
  return t('listening:reviews.pricing.fixed', { amount: formatCurrency(item.priceMinor / 100, currency, locale) });
}

/** The cohort name for a scope key: the organization itself, or a department by its heatmap name when known. */
export function scopeLabel(t: (key: string) => string, cohortKey: string, names: ReadonlyMap<string, string> = new Map()): string {
  if (cohortKey === 'company') return t('listening:reviews.scope.company');
  return names.get(cohortKey) ?? cohortKey;
}

/** The localized text of a catalogue entry. */
export function localizedText(text: Record<string, string>, locale: Locale): string {
  return text[locale] ?? text['en'] ?? Object.values(text)[0] ?? '';
}
