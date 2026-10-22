/**
 * Sample expert credentials derived from SAMPLE_EXPERTS.
 * One APPROVED credential per expert, matching their SupportArea.
 */
export const SAMPLE_EXPERT_CREDENTIALS = [
  {
    id: 'ec_expert_psych',
    expertId: 'expert_psych',
    serviceCategory: 'psychological',
    status: 'APPROVED' as const,
    sample: true as const,
  },
  {
    id: 'ec_expert_legal',
    expertId: 'expert_legal',
    serviceCategory: 'legal',
    status: 'APPROVED' as const,
    sample: true as const,
  },
  {
    id: 'ec_expert_fin',
    expertId: 'expert_fin',
    serviceCategory: 'financial',
    status: 'APPROVED' as const,
    sample: true as const,
  },
] as const;
