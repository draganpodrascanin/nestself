import type { ConversationMessage, ConversationSummary, IntakeResponse } from '@nestself/contracts';
import { SAMPLE_CASE } from './case.ts';

/**
 * A sample professional conversation: the list metadata the API returns
 * (`ConversationSummary`), the read-only messages of the single-record read
 * and the case intake, if any. `sample: true` is the fixture marker, not part
 * of the API shape.
 */
export type SampleConversation = ConversationSummary & {
  messages: ConversationMessage[];
  intake: IntakeResponse | null;
  sample: true;
};

/**
 * Conversations shown in the workspace expert area (`/cases`) and the
 * employee's own conversations (`/conversations`) in sample mode. The first
 * mirrors `SAMPLE_CASE` (the seeded case); the second, with the sample
 * employee Ana, has no intake. Bodies are bland placeholders, never clinical
 * content; nothing here was written by anyone.
 */
export const SAMPLE_CONVERSATIONS: SampleConversation[] = [
  {
    id: SAMPLE_CASE.conversation.id,
    caseId: SAMPLE_CASE.id,
    orgId: SAMPLE_CASE.orgId,
    employeeUserId: SAMPLE_CASE.employeeUserId,
    expertUserId: SAMPLE_CASE.expertUserId,
    createdAt: SAMPLE_CASE.conversation.messages[0].createdAt,
    messageCount: SAMPLE_CASE.conversation.messages.length,
    messages: SAMPLE_CASE.conversation.messages.map((m) => ({ ...m })),
    intake: {
      id: SAMPLE_CASE.intake.id,
      caseId: SAMPLE_CASE.id,
      orgId: SAMPLE_CASE.orgId,
      body: SAMPLE_CASE.intake.body,
      createdAt: SAMPLE_CASE.intake.createdAt,
    },
    sample: true,
  },
  {
    id: 'conv_sample_ana',
    caseId: 'case_sample_ana',
    orgId: SAMPLE_CASE.orgId,
    employeeUserId: 'user_ana',
    expertUserId: SAMPLE_CASE.expertUserId,
    createdAt: '2026-10-08T13:00:00.000Z',
    messageCount: 1,
    messages: [
      {
        id: 'msg_sample_ana_1',
        authorUserId: 'user_ana',
        body: 'Sample message (fixture)',
        createdAt: '2026-10-08T13:00:00.000Z',
      },
    ],
    intake: null,
    sample: true,
  },
];
