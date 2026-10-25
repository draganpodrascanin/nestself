import { WORKSPACE_URL } from '../ports';
import type { PageEntry } from '../pages';
import type { Page } from '@playwright/test';

export const workspacePages: PageEntry[] = [
  { name: 'workspace-home', url: `${WORKSPACE_URL}/` },
  { name: 'workspace-home-dark', url: `${WORKSPACE_URL}/`, theme: { palette: 'forest', mode: 'dark' } },
  { name: 'workspace-home-sr-cyrl', url: `${WORKSPACE_URL}/`, locale: 'sr-Cyrl' },
  { name: 'workspace-support', url: `${WORKSPACE_URL}/support` },
  { name: 'workspace-support-psychological', url: `${WORKSPACE_URL}/support/psychological` },
  { name: 'workspace-channels', url: `${WORKSPACE_URL}/channels` },
  { name: 'workspace-channel-detail', url: `${WORKSPACE_URL}/channels/channel_good_news` },
  { name: 'workspace-appointments', url: `${WORKSPACE_URL}/appointments` },
  { name: 'workspace-messages', url: `${WORKSPACE_URL}/messages` },
  { name: 'workspace-polls', url: `${WORKSPACE_URL}/polls` },
  { name: 'workspace-settings', url: `${WORKSPACE_URL}/settings` },
  { name: 'workspace-hr', url: `${WORKSPACE_URL}/hr?role=hr_admin`, prepare: 'setHrAdminRole' },
  { name: 'workspace-manage', url: `${WORKSPACE_URL}/manage?role=manager`, prepare: 'setManagerRole' },
  { name: 'workspace-sign-in', url: `${WORKSPACE_URL}/sign-in` },
  { name: 'workspace-content-detail', url: `${WORKSPACE_URL}/content/res_sample_evening_wind_down` },
  { name: 'workspace-saved', url: `${WORKSPACE_URL}/saved` },
  { name: 'workspace-explore', url: `${WORKSPACE_URL}/explore` },
  { name: 'workspace-requests', url: `${WORKSPACE_URL}/requests` },
];

export const workspacePrepareActions: Record<string, (page: Page) => Promise<void>> = {
  setHrAdminRole: async (_page) => {
    // The ?role=hr_admin query param is handled by SessionProvider
  },
  setManagerRole: async (_page) => {
    // The ?role=manager query param is handled by SessionProvider
  },
};
