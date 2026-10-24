/**
 * Nightly real-provider smoke test (PLT-13, OPS-33, D-CW-33, guidelines
 * 17.5): the sample employee (workspace) and the sample expert (admin) join
 * a real Amazon Chime SDK meeting in the dev account from two Chromium
 * contexts with fake devices, and each must receive the other's audio and
 * video for 30 seconds. Then the expert ends the meeting for everyone, which
 * deletes it.
 *
 * Runs only from .github/workflows/video-smoke.yml: the `video-smoke`
 * project exists only when VIDEO_SMOKE_ENABLED=true, and the API is started
 * with E2E_CALLS_VIDEO_PROVIDER=chime. Locally it is skipped (CW-R-90).
 *
 * "Hears" is measured, not assumed: every RTCPeerConnection the SDK opens is
 * recorded, and inbound audio must gain bytes and audio energy (Chromium's
 * fake microphone sends a beep) while inbound video decodes frames.
 */
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { callSession, createAppointment } from './database';
import { ADMIN_URL, WORKSPACE_URL, openAs, waitForJoinEnabled } from './journey';

test.skip(process.env.VIDEO_SMOKE_ENABLED !== 'true', 'Nightly real-provider smoke test only (VIDEO_SMOKE_ENABLED=true, VIDEO_PROVIDER=chime)');

const LISTEN_MS = 30_000;

/** Keeps every peer connection the page creates, so the test can read its inbound stats. */
function trackPeerConnections(): void {
  const Native = window.RTCPeerConnection;
  const connections: RTCPeerConnection[] = [];
  (window as unknown as { __e2ePeerConnections: RTCPeerConnection[] }).__e2ePeerConnections = connections;
  window.RTCPeerConnection = class extends Native {
    constructor(...args: ConstructorParameters<typeof RTCPeerConnection>) {
      super(...args);
      connections.push(this);
    }
  } as typeof RTCPeerConnection;
}

interface Inbound {
  audioBytes: number;
  audioEnergy: number;
  videoFrames: number;
}

function inbound(page: Page): Promise<Inbound> {
  return page.evaluate(async () => {
    const totals = { audioBytes: 0, audioEnergy: 0, videoFrames: 0 };
    const connections = (window as unknown as { __e2ePeerConnections?: RTCPeerConnection[] }).__e2ePeerConnections ?? [];
    for (const connection of connections) {
      if (connection.connectionState === 'closed') continue;
      const report = await connection.getStats();
      report.forEach((entry: Record<string, unknown>) => {
        if (entry['type'] !== 'inbound-rtp') return;
        if (entry['kind'] === 'audio') {
          totals.audioBytes += Number(entry['bytesReceived'] ?? 0);
          totals.audioEnergy += Number(entry['totalAudioEnergy'] ?? 0);
        }
        if (entry['kind'] === 'video') totals.videoFrames += Number(entry['framesDecoded'] ?? 0);
      });
    }
    return totals;
  });
}

test('two Chromium contexts join a real Chime meeting and hear and see each other', async ({ browser }, testInfo) => {
  test.setTimeout(300_000);
  const appointment = createAppointment(`smoke_${Date.now().toString(36)}`, { startsInMinutes: 2 });
  const options = { fakeMedia: false, initScripts: [trackPeerConnections] };
  const employee = await openAs(browser, testInfo, 'employee', options);
  const expert = await openAs(browser, testInfo, 'expert', options);

  await employee.page.goto(`${WORKSPACE_URL}/call/${appointment.id}`);
  await waitForJoinEnabled(employee.page);
  await employee.page.getByRole('button', { name: 'Join now' }).click();

  await expert.page.goto(`${ADMIN_URL}/consultations/${appointment.id}`);
  await expert.page.getByRole('button', { name: 'Join session' }).click();
  await waitForJoinEnabled(expert.page);
  await expert.page.getByRole('button', { name: 'Join now' }).click();

  for (const { page } of [employee, expert]) {
    await expect(page.getByRole('region', { name: 'Video call' })).toBeVisible();
    await expect(page.getByLabel(/^Video(: | of the other participant)/)).toBeVisible({ timeout: 60_000 });
  }

  const before = [await inbound(employee.page), await inbound(expert.page)];
  await employee.page.waitForTimeout(LISTEN_MS);
  const after = [await inbound(employee.page), await inbound(expert.page)];
  for (const [index, who] of ['employee', 'expert'].entries()) {
    const start = before[index]!;
    const end = after[index]!;
    testInfo.annotations.push({ type: `${who} inbound`, description: JSON.stringify({ start, end }) });
    expect(end.audioBytes - start.audioBytes, `${who} receives audio`).toBeGreaterThan(0);
    expect(end.audioEnergy - start.audioEnergy, `${who} hears the other side`).toBeGreaterThan(0);
    expect(end.videoFrames - start.videoFrames, `${who} sees the other side`).toBeGreaterThan(0);
  }

  // Tear down: the expert ends the meeting for both (DeleteMeeting).
  await expert.page.getByRole('button', { name: 'End for everyone' }).click();
  await expert.page.getByRole('alertdialog').getByRole('button', { name: 'End consultation' }).click();
  await expect(employee.page.getByText('The consultation has ended.')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => callSession(appointment.id)?.status).toBe('ENDED');

  await employee.context.close();
  await expert.context.close();
});
