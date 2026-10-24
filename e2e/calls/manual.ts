/**
 * Screenshots for the consultations user manual, taken while the journeys
 * run (founder's request, T-CW-1.7). Each entry is one screen; the journeys
 * capture it at both viewports as
 * `docs/tasks/calls-webinars/manual/screenshots/NN-<audience>-<screen>-<viewport>.png`,
 * English locale, device scale factor 2. `manual-index.ts` writes INDEX.md
 * from this list and the files on disk.
 *
 * The people on screen are the fictional sample people (Jovan, employee;
 * Milica, expert); in API mode the workspace shows "Your NestSelf expert"
 * rather than a name. In-call video is a drawn placeholder captioned
 * "Sample video", never a person.
 */
import * as path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

export const SCREENSHOT_DIR = path.resolve(import.meta.dirname, '../../docs/tasks/calls-webinars/manual/screenshots');

export interface ManualShot {
  /** Order in the manual. */
  n: number;
  route: string;
  role: string;
  state: string;
  /** The journey test and step that produces it. */
  step: string;
  /** Captured at this viewport only (the screen does not exist at the other). */
  only?: 'desktop' | 'mobile';
}

const EMPLOYEE = 'Employee (Jovan Petrović, sample), workspace app';
const EXPERT = 'Expert (Milica Ristić, sample), admin app';

export const MANUAL_SHOTS = {
  'employee-appointments-list': {
    n: 1,
    route: '/appointments',
    role: EMPLOYEE,
    state: 'Upcoming and past appointments: a confirmed consultation, a "Follow-up proposed" badge, one waiting for approval, a canceled and a completed one (seeded sample data).',
    step: 'join window states > appointments list',
  },
  'employee-appointment-before-window': {
    n: 2,
    route: '/appointments/appt_sample_upcoming',
    role: EMPLOYEE,
    state: 'Appointment detail before the join window: disabled "Come back at HH:MM" button and the 15-minute hint.',
    step: 'join window states > detail before the window',
  },
  'employee-appointment-join-open': {
    n: 3,
    route: '/appointments/:id (starts in 5 minutes)',
    role: EMPLOYEE,
    state: 'Appointment detail inside the join window: "Join session" enabled.',
    step: 'join window states > detail inside the window',
  },
  'employee-prejoin-check': {
    n: 4,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'Pre-join device check finished with camera and microphone allowed: preview, microphone level, speaker test, connection "Good", device selection, Join enabled.',
    step: 'pre-join > device check passes',
  },
  'employee-prejoin-camera-off': {
    n: 5,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'Pre-join with "Join with camera off" switched on (preview replaced by the camera-off notice) and the background blur switch.',
    step: 'pre-join > join with camera off',
  },
  'employee-call-waiting': {
    n: 6,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'In the call before the expert arrives: waiting panel with the scheduled time and tips, timer, connection badge, crisis resources and control bar.',
    step: 'consultation lifecycle > employee joins first',
  },
  'employee-call-stage': {
    n: 7,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'In-call stage with the expert present: the other participant large, the self-view in a corner, timer, connection badge, crisis resources and the control bar.',
    step: 'consultation lifecycle > both joined',
  },
  'employee-control-bar-more': {
    n: 8,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'At 390 px the secondary controls sit in the "More" overflow menu (blur, full screen, "I cannot hear you", "I cannot see you").',
    step: 'consultation lifecycle > overflow menu',
    only: 'mobile',
  },
  'employee-connection-reconnecting': {
    n: 9,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'Connection badge while the connection is lost: "Reconnecting" with the explanatory banner.',
    step: 'connection quality > reconnecting',
  },
  'employee-connection-degraded': {
    n: 10,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'Connection badge after a 30-second interval of fair quality: the yellow state with its banner.',
    step: 'connection quality > fair quality',
  },
  'employee-connection-video-paused': {
    n: 11,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'Degraded mode after two poor intervals: red badge and "video paused, audio continues" banner.',
    step: 'connection quality > outgoing video paused',
  },
  'employee-crisis-resources': {
    n: 12,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'Crisis resources open in a sheet during the call (Serbian hotlines, disclaimer); the call keeps running.',
    step: 'consultation lifecycle > crisis resources',
  },
  'employee-five-minute-cue': {
    n: 13,
    route: '/call/:id (ends in about 4 minutes)',
    role: EMPLOYEE,
    state: 'Session timer with the dismissable "5 minutes remaining" cue.',
    step: 'five-minute cue',
  },
  'expert-consultations-list': {
    n: 14,
    route: '/consultations',
    role: EXPERT,
    state: "The expert's consultations: employee label, service, time in the appointment's zone, status and outcome.",
    step: 'admin consultations > list',
  },
  'expert-consultation-detail': {
    n: 15,
    route: '/consultations/:id',
    role: EXPERT,
    state: 'Consultation detail inside the join window: participants, time, status, Join and the running-late signal.',
    step: 'admin consultations > detail',
  },
  'expert-call-stage': {
    n: 16,
    route: '/consultations/:id (in call)',
    role: EXPERT,
    state: "The expert's call: the employee's video, self-view, timer, connection badge, crisis resources with expert guidance, the shared-location panel and the control bar with screen sharing and End for everyone.",
    step: 'consultation lifecycle > both joined',
  },
  'expert-end-for-everyone': {
    n: 17,
    route: '/consultations/:id (in call)',
    role: EXPERT,
    state: '"End for everyone" confirmation dialog.',
    step: 'consultation lifecycle > end for everyone',
  },
  'employee-session-ended': {
    n: 18,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'The expert ended the session: the stage says so for five seconds before the post-call screen.',
    step: 'consultation lifecycle > session ended',
  },
  'employee-post-call-feedback': {
    n: 19,
    route: '/call/:id (post-call)',
    role: EMPLOYEE,
    state: 'Post-call screen: private feedback (1 to 5 and an optional comment), "Report a technical problem".',
    step: 'consultation lifecycle > post-call screen',
  },
  'employee-report-problem': {
    n: 20,
    route: '/call/:id (post-call)',
    role: EMPLOYEE,
    state: '"Report a technical problem" dialog listing exactly what is sent (duration, reconnections, quality, browser, OS).',
    step: 'consultation lifecycle > report a technical problem',
  },
  'expert-outcome-dialog': {
    n: 21,
    route: '/consultations/:id (after the call)',
    role: EXPERT,
    state: 'Outcome dialog right after ending: the five delivery statuses, no notes field.',
    step: 'consultation lifecycle > outcome',
  },
  'expert-follow-up-propose': {
    n: 22,
    route: '/consultations/:id (after the outcome)',
    role: EXPERT,
    state: 'Follow-up card after a completed outcome: date, time and duration in the appointment\'s time zone, fixed note, no free text.',
    step: 'consultation lifecycle > follow-up proposal',
  },
  'employee-follow-up-proposal': {
    n: 23,
    route: '/call/:id (post-call)',
    role: EMPLOYEE,
    state: 'The proposal arrives on the post-call screen: Confirm, Suggest other times, Decline.',
    step: 'consultation lifecycle > follow-up arrives',
  },
  'employee-follow-up-suggest-times': {
    n: 24,
    route: '/call/:id (post-call)',
    role: EMPLOYEE,
    state: '"Suggest other times" expanded: up to three windows in the appointment\'s time zone.',
    step: 'consultation lifecycle > suggest other times',
  },
  'employee-follow-up-confirmed': {
    n: 25,
    route: '/call/:id (post-call)',
    role: EMPLOYEE,
    state: 'The employee confirmed the follow-up (or it waits for approval, depending on the organization policy).',
    step: 'consultation lifecycle > follow-up confirmed',
  },
  'employee-follow-up-times-suggested': {
    n: 26,
    route: '/appointments/:id (a proposed follow-up)',
    role: EMPLOYEE,
    state: 'The employee sent other times from the appointment page: the card says the expert will choose one of them.',
    step: 'follow-up answers > suggest other times',
  },
  'employee-follow-up-declined': {
    n: 27,
    route: '/appointments/:id (a proposed follow-up)',
    role: EMPLOYEE,
    state: 'The employee declined a proposed follow-up from the appointment page.',
    step: 'follow-up answers > decline',
  },
  'employee-window-closed': {
    n: 28,
    route: '/appointments/:id (ended 2 hours ago)',
    role: EMPLOYEE,
    state: 'Join window closed: the message and the contact-support link instead of Join.',
    step: 'closed window > detail page',
  },
  'employee-join-refused': {
    n: 29,
    route: '/call/:id',
    role: EMPLOYEE,
    state: 'The API refused the join (403 join_window_closed): the translated error inside the pre-join check.',
    step: 'closed window > server refuses the join',
  },
} as const satisfies Record<string, ManualShot>;

export type ManualShotKey = keyof typeof MANUAL_SHOTS;

export function viewportOf(testInfo: TestInfo): 'desktop' | 'mobile' {
  return testInfo.project.name.includes('mobile') ? 'mobile' : 'desktop';
}

export function shotFile(key: ManualShotKey, viewport: 'desktop' | 'mobile'): string {
  return `${String(MANUAL_SHOTS[key].n).padStart(2, '0')}-${key}-${viewport}.png`;
}

/** Captures the viewport once animations have finished (the frames on screen, not the full page). */
export async function shot(page: Page, testInfo: TestInfo, key: ManualShotKey): Promise<void> {
  const viewport = viewportOf(testInfo);
  const only: string | undefined = (MANUAL_SHOTS[key] as ManualShot).only;
  if (only && only !== viewport) return;
  await page.evaluate(() => document.fonts.ready);
  // Let Motion's entries finish: the longest token is 280 ms.
  await page.waitForTimeout(450);
  await page.screenshot({
    path: path.join(SCREENSHOT_DIR, shotFile(key, viewport)),
    fullPage: false,
    animations: 'disabled',
    caret: 'hide',
  });
}

/** Defects found while producing the journeys and screenshots (T-CW-1.7). */
export interface Defect {
  id: string;
  summary: string;
  effect: string;
  /** The commit that fixed it, or null while open. */
  fixedBy: string | null;
}

export const DEFECTS: Defect[] = [
  {
    id: 'DEF-1',
    summary: 'amazon-chime-sdk-js reads Node\'s `global` (CSPMonitor.register in DefaultMeetingSession); browsers have none.',
    effect: 'Every pre-join check failed (camera and microphone "Not working", connection "Offline") and Join stayed disabled, in both apps.',
    fixedBy: 'ee2dc6b fix(video): define global before loading the Chime SDK (T-CW-1.4)',
  },
  {
    id: 'DEF-2',
    summary: 'The workspace and admin Tailwind builds did not scan packages/video/src.',
    effect: 'Classes used only by the call components were missing: the self-view covered the whole stage, overlays lost their stacking, the preview box its aspect ratio.',
    fixedBy: '298316a fix(web): scan the video package for Tailwind classes in both apps',
  },
  {
    id: 'DEF-3',
    summary: 'GET /auth/me returned no effective actions for the expert: assignment-scoped grants (assigned_cases) never passed the synthetic-resource check.',
    effect: 'The admin app showed "This view is not available to your role" on /consultations and /consultations/:id, so the expert could not join, end, record an outcome or propose a follow-up.',
    fixedBy: '88180b7 fix(api): effective actions include assignment-scoped grants backed by an active assignment (T-CW-1.1)',
  },
];

/** Screens that cannot be captured yet, with the defect or missing feature behind them. */
export const NOT_CAPTURED: Partial<Record<ManualShotKey, string>> = {};
