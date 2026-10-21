import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-home', url: 'http://localhost:3000/en' },
  {
    name: 'marketing-home-dark',
    url: 'http://localhost:3000/en',
    theme: { palette: 'forest', mode: 'dark' },
  },
  {
    name: 'marketing-home-sr-cyrl',
    url: 'http://localhost:3000/sr-Cyrl',
    locale: 'sr-Cyrl',
  },
  {
    name: 'marketing-home-hu',
    url: 'http://localhost:3000/hu',
    locale: 'hu',
  },
];
