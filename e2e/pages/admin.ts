import type { PageEntry } from '../pages';

export const adminPages: PageEntry[] = [
  { name: 'admin-home', url: 'http://localhost:5174/' },
  { name: 'admin-home-dark', url: 'http://localhost:5174/', theme: { palette: 'forest', mode: 'dark' } },
  { name: 'admin-home-sr-cyrl', url: 'http://localhost:5174/', locale: 'sr-Cyrl' },
  { name: 'admin-experts', url: 'http://localhost:5174/experts' },
  { name: 'admin-consultations', url: 'http://localhost:5174/consultations?role=expert' },
  { name: 'admin-consultations-operations', url: 'http://localhost:5174/consultations?role=operations' },
  { name: 'admin-consultation-completed', url: 'http://localhost:5174/consultations/appt_sample_completed?role=expert' },
  { name: 'admin-consultation-upcoming', url: 'http://localhost:5174/consultations/appt_sample_upcoming?role=expert' },
  // M1 completion: booking, the operations read-only view with Cancel, and call support (sample mode).
  { name: 'admin-consultation-new', url: 'http://localhost:5174/consultations/new?role=operations' },
  { name: 'admin-consultation-operations', url: 'http://localhost:5174/consultations/appt_sample_upcoming?role=operations' },
  { name: 'admin-support-calls', url: 'http://localhost:5174/support/calls?role=operations' },
  // T-CW-2.4: the occurrence list, form and detail, and the moderator console before joining (sample mode).
  { name: 'admin-webinars', url: 'http://localhost:5174/webinars?role=operations' },
  { name: 'admin-webinar-new', url: 'http://localhost:5174/webinars/new?role=operations' },
  { name: 'admin-webinar-detail', url: 'http://localhost:5174/webinars/webinar_sample_upcoming?role=operations' },
  { name: 'admin-webinar-console', url: 'http://localhost:5174/webinars/webinar_sample_upcoming/live?role=operations' },
  { name: 'admin-organizations', url: 'http://localhost:5174/organizations' },
  { name: 'admin-content', url: 'http://localhost:5174/content' },
  { name: 'admin-event-requests', url: 'http://localhost:5174/event-requests' },
  { name: 'admin-settings', url: 'http://localhost:5174/settings' },
  { name: 'admin-sign-in', url: 'http://localhost:5174/sign-in' },
];
