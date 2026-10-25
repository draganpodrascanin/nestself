/**
 * Sample-mode views of `SAMPLE_CONVERSATIONS`: the same shapes the API
 * returns, so the screens render fixtures through the code paths they use
 * for real data. Nothing is read from or written to a server.
 */
import { SAMPLE_CONVERSATIONS } from '@nestself/sample-data';
import type { ConversationResponse, ConversationSummary, IntakeResponse } from '@nestself/contracts';

function summary(row: (typeof SAMPLE_CONVERSATIONS)[number]): ConversationSummary {
  const { messages: _messages, intake: _intake, sample: _sample, ...rest } = row;
  return rest;
}

/** The sample conversations of cases assigned to `expertUserId`. */
export function sampleAssigned(expertUserId: string): ConversationSummary[] {
  return SAMPLE_CONVERSATIONS.filter((c) => c.expertUserId === expertUserId).map(summary);
}

/** The sample conversations in which `employeeUserId` is the participant. */
export function sampleMine(employeeUserId: string): ConversationSummary[] {
  return SAMPLE_CONVERSATIONS.filter((c) => c.employeeUserId === employeeUserId).map(summary);
}

export function sampleConversation(id: string): ConversationResponse | null {
  const row = SAMPLE_CONVERSATIONS.find((c) => c.id === id);
  return row ? { id: row.id, caseId: row.caseId, orgId: row.orgId, messages: row.messages } : null;
}

/** The sample summary of conversation `id`, or null. */
export function sampleSummary(id: string): ConversationSummary | null {
  const row = SAMPLE_CONVERSATIONS.find((c) => c.id === id);
  return row ? summary(row) : null;
}

export function sampleIntake(id: string): IntakeResponse | null {
  return SAMPLE_CONVERSATIONS.find((c) => c.intake?.id === id)?.intake ?? null;
}

/** The intake id of the sample conversation `id`, if it has one. */
export function sampleIntakeIdFor(conversationId: string): string | null {
  return SAMPLE_CONVERSATIONS.find((c) => c.id === conversationId)?.intake?.id ?? null;
}
