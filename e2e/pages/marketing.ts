import type { PageEntry } from '../pages';

export const marketingPages: PageEntry[] = [
  { name: 'marketing-home', url: 'http://localhost:3000/en' },
  { name: 'marketing-home-dark', url: 'http://localhost:3000/en', theme: { palette: 'forest', mode: 'dark' } },
  { name: 'marketing-home-sr-cyrl', url: 'http://localhost:3000/sr-Cyrl', locale: 'sr-Cyrl' },
  { name: 'marketing-support', url: 'http://localhost:3000/en/support' },
  { name: 'marketing-employers', url: 'http://localhost:3000/en/employers' },
  { name: 'marketing-privacy-model', url: 'http://localhost:3000/en/privacy-model' },
  { name: 'marketing-credits', url: 'http://localhost:3000/en/credits' },
];
