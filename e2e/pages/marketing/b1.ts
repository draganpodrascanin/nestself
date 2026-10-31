import { MARKETING_URL } from '../../ports';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-home', url: `${MARKETING_URL}/`, locale: 'sr-Latn' },
  {
    name: 'marketing-home-dark',
    url: `${MARKETING_URL}/`,
    locale: 'sr-Latn',
    theme: { palette: 'forest', mode: 'dark' },
  },
  {
    name: 'marketing-home-en',
    url: `${MARKETING_URL}/en`,
  },
  {
    name: 'marketing-home-sr-cyrl',
    url: `${MARKETING_URL}/sr-Cyrl`,
    locale: 'sr-Cyrl',
  },
  {
    name: 'marketing-home-hu',
    url: `${MARKETING_URL}/hu`,
    locale: 'hu',
  },
];
