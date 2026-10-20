import type { PageEntry } from '../pages';

export const adminPages: PageEntry[] = [
  { name: 'admin-home', url: 'http://localhost:5174/' },
  { name: 'admin-home-dark', url: 'http://localhost:5174/', theme: { palette: 'forest', mode: 'dark' } },
  { name: 'admin-home-sr-cyrl', url: 'http://localhost:5174/', locale: 'sr-Cyrl' },
  { name: 'admin-experts', url: 'http://localhost:5174/experts' },
  { name: 'admin-organizations', url: 'http://localhost:5174/organizations' },
  { name: 'admin-content', url: 'http://localhost:5174/content' },
  { name: 'admin-event-requests', url: 'http://localhost:5174/event-requests' },
  { name: 'admin-settings', url: 'http://localhost:5174/settings' },
];
