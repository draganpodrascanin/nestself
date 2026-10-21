import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-services', url: 'http://localhost:3000/en/services' },
  { name: 'marketing-services-hu', url: 'http://localhost:3000/hu/services', locale: 'hu' },
  { name: 'marketing-services-sr-cyrl', url: 'http://localhost:3000/sr-Cyrl/services', locale: 'sr-Cyrl' },
  { name: 'marketing-services-therapy', url: 'http://localhost:3000/en/services/therapy' },
  { name: 'marketing-services-therapy-hu', url: 'http://localhost:3000/hu/services/therapy', locale: 'hu' },
  { name: 'marketing-services-therapy-sr-cyrl', url: 'http://localhost:3000/sr-Cyrl/services/therapy', locale: 'sr-Cyrl' },
  { name: 'marketing-services-legal-consultation', url: 'http://localhost:3000/en/services/legal-consultation' },
  { name: 'marketing-services-legal-consultation-hu', url: 'http://localhost:3000/hu/services/legal-consultation', locale: 'hu' },
  { name: 'marketing-services-financial-guidance', url: 'http://localhost:3000/en/services/financial-guidance' },
  { name: 'marketing-services-financial-guidance-hu', url: 'http://localhost:3000/hu/services/financial-guidance', locale: 'hu' },
];
