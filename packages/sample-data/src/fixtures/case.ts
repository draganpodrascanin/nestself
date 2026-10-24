/**
 * One sample case in the confidential professional domain (T-2.4): a
 * conversation between the sample employee and the sample expert, and an
 * intake record. Bodies are bland placeholders, never clinical content.
 * The expert reaches the case through a CASE assignment targeting `id`.
 */
export const SAMPLE_CASE = {
  id: 'case_sample',
  orgId: 'org_sample',
  employeeUserId: 'user_jovan',
  expertUserId: 'user_milica',
  conversation: {
    id: 'conv_sample',
    messages: [
      {
        id: 'msg_sample_1',
        authorUserId: 'user_jovan',
        body: 'Sample message (fixture)',
        createdAt: '2026-10-01T09:00:00.000Z',
      },
      {
        id: 'msg_sample_2',
        authorUserId: 'user_milica',
        body: 'Sample reply (fixture)',
        createdAt: '2026-10-01T09:05:00.000Z',
      },
    ],
  },
  intake: {
    id: 'intake_sample',
    body: 'Sample intake notes (fixture)',
    createdAt: '2026-10-01T08:55:00.000Z',
  },
  sample: true as const,
} as const;
