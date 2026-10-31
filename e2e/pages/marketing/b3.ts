import { MARKETING_URL } from '../../ports';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-services', url: `${MARKETING_URL}/services`, locale: 'sr-Latn' },
  { name: 'marketing-services-en', url: `${MARKETING_URL}/en/services` },
  { name: 'marketing-services-hu', url: `${MARKETING_URL}/hu/services`, locale: 'hu' },
  { name: 'marketing-services-sr-cyrl', url: `${MARKETING_URL}/sr-Cyrl/services`, locale: 'sr-Cyrl' },
  { name: 'marketing-services-therapy', url: `${MARKETING_URL}/services/therapy`, locale: 'sr-Latn' },
  { name: 'marketing-services-therapy-en', url: `${MARKETING_URL}/en/services/therapy` },
  { name: 'marketing-services-therapy-hu', url: `${MARKETING_URL}/hu/services/therapy`, locale: 'hu' },
  { name: 'marketing-services-therapy-sr-cyrl', url: `${MARKETING_URL}/sr-Cyrl/services/therapy`, locale: 'sr-Cyrl' },
  { name: 'marketing-services-legal-consultation', url: `${MARKETING_URL}/services/legal-consultation`, locale: 'sr-Latn' },
  { name: 'marketing-services-legal-consultation-en', url: `${MARKETING_URL}/en/services/legal-consultation` },
  { name: 'marketing-services-legal-consultation-hu', url: `${MARKETING_URL}/hu/services/legal-consultation`, locale: 'hu' },
  { name: 'marketing-services-financial-guidance', url: `${MARKETING_URL}/services/financial-guidance`, locale: 'sr-Latn' },
  { name: 'marketing-services-financial-guidance-en', url: `${MARKETING_URL}/en/services/financial-guidance` },
  { name: 'marketing-services-financial-guidance-hu', url: `${MARKETING_URL}/hu/services/financial-guidance`, locale: 'hu' },
];
