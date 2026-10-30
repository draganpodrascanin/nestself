import { ADMIN_URL } from '../ports';
import type { PageEntry } from '../pages';

export const adminPages: PageEntry[] = [
  { name: 'admin-home', url: `${ADMIN_URL}/` },
  { name: 'admin-home-dark', url: `${ADMIN_URL}/`, theme: { palette: 'forest', mode: 'dark' } },
  { name: 'admin-home-sr-cyrl', url: `${ADMIN_URL}/`, locale: 'sr-Cyrl' },
  { name: 'admin-experts', url: `${ADMIN_URL}/experts` },
  { name: 'admin-consultations', url: `${ADMIN_URL}/consultations?role=expert` },
  { name: 'admin-consultations-operations', url: `${ADMIN_URL}/consultations?role=operations` },
  { name: 'admin-consultation-completed', url: `${ADMIN_URL}/consultations/appt_sample_completed?role=expert` },
  { name: 'admin-consultation-upcoming', url: `${ADMIN_URL}/consultations/appt_sample_upcoming?role=expert` },
  // M1 completion: booking, the operations read-only view with Cancel, and call support (sample mode).
  { name: 'admin-consultation-new', url: `${ADMIN_URL}/consultations/new?role=operations` },
  { name: 'admin-consultation-operations', url: `${ADMIN_URL}/consultations/appt_sample_upcoming?role=operations` },
  { name: 'admin-support-calls', url: `${ADMIN_URL}/support/calls?role=operations` },
  // T-CW-2.4: the occurrence list, form and detail, and the moderator console before joining (sample mode).
  { name: 'admin-webinars', url: `${ADMIN_URL}/webinars?role=operations` },
  { name: 'admin-webinar-new', url: `${ADMIN_URL}/webinars/new?role=operations` },
  { name: 'admin-webinar-detail', url: `${ADMIN_URL}/webinars/webinar_sample_upcoming?role=operations` },
  { name: 'admin-webinar-console', url: `${ADMIN_URL}/webinars/webinar_sample_upcoming/live?role=operations` },
  { name: 'admin-webinars-presenter', url: `${ADMIN_URL}/webinars?role=expert` },
  { name: 'admin-webinar-edit', url: `${ADMIN_URL}/webinars/webinar_sample_upcoming/edit?role=operations` },
  { name: 'admin-webinar-ended', url: `${ADMIN_URL}/webinars/webinar_sample_ended?role=operations` },
  { name: 'admin-organizations', url: `${ADMIN_URL}/organizations` },
  { name: 'admin-content', url: `${ADMIN_URL}/content` },
  { name: 'admin-event-requests', url: `${ADMIN_URL}/event-requests` },
  { name: 'admin-settings', url: `${ADMIN_URL}/settings` },
  { name: 'admin-sign-in', url: `${ADMIN_URL}/sign-in` },
];
