/**
 * Shared labels and tones of the feedback screens: a state is always shown
 * as text next to its colour, and the recipient is always a function, never
 * an account.
 */
import type { FeedbackCaseState, FeedbackRouteChoice } from '@nestself/contracts';
import type { BadgeTone } from '@nestself/ui';

export const STATE_TONE: Record<FeedbackCaseState, BadgeTone> = {
  submitted: 'info',
  in_review: 'warning',
  waiting_for_reporter: 'warning',
  action_in_progress: 'info',
  resolved: 'success',
  closed: 'neutral',
};

/** The reporter's wording of a state (`waiting_for_reporter` reads "Waiting for you"). */
export const reporterStateKey = (state: FeedbackCaseState) => `listening:feedback.state.${state}` as const;
/** The handler's wording of a state. */
export const handlerStateKey = (state: FeedbackCaseState) => `listening:feedback.stateHandler.${state}` as const;
export const functionKey = (choice: FeedbackRouteChoice) => `listening:feedback.function.${choice}` as const;
export const kindKey = (kind: 'problem' | 'suggestion') => `listening:feedback.kind.${kind}` as const;

const KNOWN_CATEGORIES = new Set(['workload', 'management', 'communication', 'equipment', 'safety', 'other']);

/** A translated category label for the pilot's categories; an organization's own category is shown as typed. */
export function categoryLabel(t: (key: string) => string, category: string): string {
  return KNOWN_CATEGORIES.has(category) ? t(`listening:feedback.categories.${category}`) : category;
}

/** The other recipient of a route than the one holding the case. */
export function otherChoice(choice: FeedbackRouteChoice): FeedbackRouteChoice {
  return choice === 'primary' ? 'alternate' : 'primary';
}
