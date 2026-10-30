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
  { name: 'workspace-appointment-proposed', url: `${WORKSPACE_URL}/appointments/appt_sample_follow_up_proposed` },
  { name: 'workspace-appointment-upcoming', url: `${WORKSPACE_URL}/appointments/appt_sample_upcoming` },
  { name: 'workspace-call-prejoin', url: `${WORKSPACE_URL}/call/appt_sample_upcoming` },
  { name: 'workspace-call-waiting', url: `${WORKSPACE_URL}/call/appt_sample_upcoming`, prepare: 'joinSampleCall' },
  { name: 'workspace-call-post', url: `${WORKSPACE_URL}/call/appt_sample_upcoming`, prepare: 'leaveSampleCall' },
  // T-CW-2.4: webinar discovery, detail with the lobby, and the attendee's live view (sample mode).
  { name: 'workspace-webinars', url: `${WORKSPACE_URL}/webinars` },
  { name: 'workspace-webinar-detail', url: `${WORKSPACE_URL}/webinars/webinar_sample_upcoming` },
  { name: 'workspace-webinar-prejoin', url: `${WORKSPACE_URL}/webinars/webinar_sample_upcoming/live` },
  { name: 'workspace-webinar-live', url: `${WORKSPACE_URL}/webinars/webinar_sample_upcoming/live`, prepare: 'joinSampleWebinar' },
  { name: 'workspace-messages', url: `${WORKSPACE_URL}/messages` },
  { name: 'workspace-polls', url: `${WORKSPACE_URL}/polls` },
  { name: 'workspace-settings', url: `${WORKSPACE_URL}/settings` },
  { name: 'workspace-hr', url: `${WORKSPACE_URL}/hr?role=hr_admin`, prepare: 'setHrAdminRole' },
  { name: 'workspace-manage', url: `${WORKSPACE_URL}/manage?role=manager`, prepare: 'setManagerRole' },
  // T-CW-1.10. The sample HR admin (user_ivana) is the sample approver: /approvals lists SAMPLE_APPROVAL_ITEMS.
  { name: 'workspace-approvals', url: `${WORKSPACE_URL}/approvals?role=hr_admin`, prepare: 'setHrAdminRole' },
  { name: 'workspace-follow-up-policy', url: `${WORKSPACE_URL}/follow-up-policy?role=hr_admin`, prepare: 'setHrAdminRole' },
  { name: 'workspace-sign-in', url: `${WORKSPACE_URL}/sign-in` },
  { name: 'workspace-content-detail', url: `${WORKSPACE_URL}/content/res_sample_evening_wind_down` },
  { name: 'workspace-saved', url: `${WORKSPACE_URL}/saved` },
  { name: 'workspace-explore', url: `${WORKSPACE_URL}/explore` },
  { name: 'workspace-requests', url: `${WORKSPACE_URL}/requests` },
];

/** Waits for the fake pre-join check to enable "Join now", then selects it. */
async function joinWhenReady(page: Page): Promise<void> {
  const join = page.getByRole('button', { name: 'Join now' });
  await join.waitFor();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('button')).some((button) => button.textContent?.includes('Join now') && !button.disabled),
  );
  await join.click();
}

/** Sample mode: the pre-join check passes with the fake controller, then Join starts the demonstration call. */
async function joinSampleCall(page: Page): Promise<void> {
  await joinWhenReady(page);
  await page.getByText(/will join shortly/).waitFor();
}

/** Sample mode: the attendee's pre-join check passes, then Join opens the demonstration webinar. */
async function joinSampleWebinar(page: Page): Promise<void> {
  await joinWhenReady(page);
  await page.getByTestId('webinar-attendee-controls').waitFor();
}

export const workspacePrepareActions: Record<string, (page: Page) => Promise<void>> = {
  joinSampleCall,
  joinSampleWebinar,
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
