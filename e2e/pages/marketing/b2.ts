import { MARKETING_URL } from '../../ports';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-for-employers', url: `${MARKETING_URL}/for-employers`, locale: 'sr-Latn' },
  { name: 'marketing-for-employers-en', url: `${MARKETING_URL}/en/for-employers` },
  { name: 'marketing-for-employers-hu', url: `${MARKETING_URL}/hu/for-employers`, locale: 'hu' },
  { name: 'marketing-for-employers-sr-cyrl', url: `${MARKETING_URL}/sr-Cyrl/for-employers`, locale: 'sr-Cyrl' },
  { name: 'marketing-for-employees', url: `${MARKETING_URL}/for-employees`, locale: 'sr-Latn' },
  { name: 'marketing-for-employees-en', url: `${MARKETING_URL}/en/for-employees` },
  { name: 'marketing-for-employees-hu', url: `${MARKETING_URL}/hu/for-employees`, locale: 'hu' },
  { name: 'marketing-for-managers', url: `${MARKETING_URL}/for-managers`, locale: 'sr-Latn' },
  { name: 'marketing-for-managers-en', url: `${MARKETING_URL}/en/for-managers` },
  { name: 'marketing-for-managers-hu', url: `${MARKETING_URL}/hu/for-managers`, locale: 'hu' },
  { name: 'marketing-plans', url: `${MARKETING_URL}/plans`, locale: 'sr-Latn' },
  { name: 'marketing-plans-en', url: `${MARKETING_URL}/en/plans` },
  { name: 'marketing-plans-hu', url: `${MARKETING_URL}/hu/plans`, locale: 'hu' },
  { name: 'marketing-about', url: `${MARKETING_URL}/about`, locale: 'sr-Latn' },
  { name: 'marketing-about-en', url: `${MARKETING_URL}/en/about` },
  { name: 'marketing-about-hu', url: `${MARKETING_URL}/hu/about`, locale: 'hu' },
  { name: 'marketing-faq', url: `${MARKETING_URL}/faq`, locale: 'sr-Latn' },
  { name: 'marketing-faq-en', url: `${MARKETING_URL}/en/faq` },
  { name: 'marketing-faq-hu', url: `${MARKETING_URL}/hu/faq`, locale: 'hu' },
];
