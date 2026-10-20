import type { PageEntry } from '../pages';
import type { Page } from '@playwright/test';

export const workspacePages: PageEntry[] = [
  { name: 'workspace-home', url: 'http://localhost:5173/' },
  { name: 'workspace-home-dark', url: 'http://localhost:5173/', theme: { palette: 'forest', mode: 'dark' } },
  { name: 'workspace-home-sr-cyrl', url: 'http://localhost:5173/', locale: 'sr-Cyrl' },
  { name: 'workspace-support', url: 'http://localhost:5173/support' },
  { name: 'workspace-support-psychological', url: 'http://localhost:5173/support/psychological' },
  { name: 'workspace-channels', url: 'http://localhost:5173/channels' },
  { name: 'workspace-channel-detail', url: 'http://localhost:5173/channels/channel_good_news' },
  { name: 'workspace-appointments', url: 'http://localhost:5173/appointments' },
  { name: 'workspace-messages', url: 'http://localhost:5173/messages' },
  { name: 'workspace-polls', url: 'http://localhost:5173/polls' },
  { name: 'workspace-settings', url: 'http://localhost:5173/settings' },
  { name: 'workspace-hr', url: 'http://localhost:5173/hr?role=hr_admin', prepare: 'setHrAdminRole' },
  { name: 'workspace-manage', url: 'http://localhost:5173/manage?role=manager', prepare: 'setManagerRole' },
];

export const workspacePrepareActions: Record<string, (page: Page) => Promise<void>> = {
  setHrAdminRole: async (_page) => {
    // The ?role=hr_admin query param is handled by SessionProvider
  },
  setManagerRole: async (_page) => {
    // The ?role=manager query param is handled by SessionProvider
  },
};
