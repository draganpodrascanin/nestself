import type { SupportArea } from '@nestself/contracts';

interface SampleArticle {
  readonly id: string;
  readonly title: string;
  readonly area: SupportArea;
  readonly locale: 'en';
  readonly summary: string;
  readonly sample: true;
}

export const SAMPLE_CONTENT: readonly SampleArticle[] = [
  {
    id: 'article_burnout',
    title: 'Recognizing Burnout Early',
    area: 'psychological',
    locale: 'en',
    summary:
      'Burnout can develop gradually, making it hard to spot before it affects your work and health. Learn the early warning signs and practical steps to protect your well-being.',
    sample: true,
  },
  {
    id: 'article_rights',
    title: 'Understanding Your Employment Rights',
    area: 'legal',
    locale: 'en',
    summary:
      'Employment law can feel overwhelming, but knowing the basics protects you. This guide covers the key rights every employee should understand.',
    sample: true,
  },
  {
    id: 'article_saving',
    title: 'Building a Practical Savings Plan',
    area: 'financial',
    locale: 'en',
    summary:
      'Starting to save can be the hardest part, especially when budgets are tight. A structured approach helps you build stability without feeling deprived.',
    sample: true,
  },
];
