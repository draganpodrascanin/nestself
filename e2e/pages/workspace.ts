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
  { name: 'workspace-appointment-proposed', url: 'http://localhost:5173/appointments/appt_sample_follow_up_proposed' },
  { name: 'workspace-appointment-upcoming', url: 'http://localhost:5173/appointments/appt_sample_upcoming' },
  { name: 'workspace-call-prejoin', url: 'http://localhost:5173/call/appt_sample_upcoming' },
  { name: 'workspace-call-waiting', url: 'http://localhost:5173/call/appt_sample_upcoming', prepare: 'joinSampleCall' },
  { name: 'workspace-call-post', url: 'http://localhost:5173/call/appt_sample_upcoming', prepare: 'leaveSampleCall' },
  { name: 'workspace-messages', url: 'http://localhost:5173/messages' },
  { name: 'workspace-polls', url: 'http://localhost:5173/polls' },
  { name: 'workspace-settings', url: 'http://localhost:5173/settings' },
  { name: 'workspace-hr', url: 'http://localhost:5173/hr?role=hr_admin', prepare: 'setHrAdminRole' },
  { name: 'workspace-manage', url: 'http://localhost:5173/manage?role=manager', prepare: 'setManagerRole' },
  // T-CW-1.10. No sample role holds approval.decide, so in sample mode /approvals shows the access notice on home.
  { name: 'workspace-approvals', url: 'http://localhost:5173/approvals?role=manager', prepare: 'setManagerRole' },
  { name: 'workspace-follow-up-policy', url: 'http://localhost:5173/follow-up-policy?role=hr_admin', prepare: 'setHrAdminRole' },
  { name: 'workspace-sign-in', url: 'http://localhost:5173/sign-in' },
];

/** Sample mode: the pre-join check passes with the fake controller, then Join starts the demonstration call. */
async function joinSampleCall(page: Page): Promise<void> {
  const join = page.getByRole('button', { name: 'Join now' });
  await join.waitFor();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('Join now') && !button.disabled),
  );
  await join.click();
  await page.getByText(/will join shortly/).waitFor();
}

export const workspacePrepareActions: Record<string, (page: Page) => Promise<void>> = {
  joinSampleCall,
  leaveSampleCall: async (page) => {
    await joinSampleCall(page);
    await page.getByRole('button', { name: 'Leave' }).first().click();
    await page.getByRole('heading', { name: 'You left the consultation' }).waitFor();
  },
  setHrAdminRole: async (_page) => {
    // The ?role=hr_admin query param is handled by SessionProvider
  },
  setManagerRole: async (_page) => {
    // The ?role=manager query param is handled by SessionProvider
  },
};
