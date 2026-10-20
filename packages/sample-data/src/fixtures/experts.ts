import type { SupportArea } from '@nestself/contracts';

interface SampleExpert {
  readonly id: string;
  readonly initials: string;
  readonly area: SupportArea;
  readonly portrait: null;
  readonly sample: true;
}

export const SAMPLE_EXPERTS: readonly SampleExpert[] = [
  { id: 'expert_psych', initials: 'MR', area: 'psychological', portrait: null, sample: true },
  { id: 'expert_legal', initials: 'DV', area: 'legal', portrait: null, sample: true },
  { id: 'expert_fin', initials: 'TK', area: 'financial', portrait: null, sample: true },
];
