/**
 * Sample expert credentials derived from SAMPLE_EXPERTS.
 * One APPROVED credential per expert, matching their SupportArea, plus the
 * workplace review qualification of the psychological expert (Milica), who is
 * the sample workplace reviewer (ADR 0002, D-EL-11).
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
  {
    id: 'ec_expert_psych_workplace_review',
    expertId: 'expert_psych',
    serviceCategory: 'workplace_review',
    status: 'APPROVED' as const,
    sample: true as const,
  },
] as const;
