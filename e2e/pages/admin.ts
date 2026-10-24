import { ADMIN_URL } from '../ports';
import type { PageEntry } from '../pages';

export const adminPages: PageEntry[] = [
  { name: 'admin-home', url: `${ADMIN_URL}/` },
  { name: 'admin-home-dark', url: `${ADMIN_URL}/`, theme: { palette: 'forest', mode: 'dark' } },
  { name: 'admin-home-sr-cyrl', url: `${ADMIN_URL}/`, locale: 'sr-Cyrl' },
  { name: 'admin-experts', url: `${ADMIN_URL}/experts` },
  { name: 'admin-organizations', url: `${ADMIN_URL}/organizations` },
  { name: 'admin-content', url: `${ADMIN_URL}/content` },
  { name: 'admin-event-requests', url: `${ADMIN_URL}/event-requests` },
  { name: 'admin-settings', url: `${ADMIN_URL}/settings` },
  { name: 'admin-sign-in', url: `${ADMIN_URL}/sign-in` },
];
