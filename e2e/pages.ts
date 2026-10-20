export interface PageEntry {
  name: string;
  url: string;
  theme?: { palette: 'forest' | 'ink' | 'plum' | 'azure'; mode: 'light' | 'dark' };
  locale?: 'en' | 'sr-Latn' | 'sr-Cyrl';
  prepare?: string;
}

export const pages: PageEntry[] = [
  { name: 'marketing-home', url: 'http://localhost:3000/en' },
  { name: 'marketing-home-sr-cyrl', url: 'http://localhost:3000/sr-Cyrl' },
  { name: 'marketing-home-dark', url: 'http://localhost:3000/en', theme: { palette: 'forest', mode: 'dark' } },
  { name: 'workspace-home', url: 'http://localhost:5173/' },
  { name: 'admin-home', url: 'http://localhost:5174/' },
];
