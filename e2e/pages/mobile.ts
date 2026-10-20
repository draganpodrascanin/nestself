import type { PageEntry } from '../pages';

// Mobile app pages are verified via expo export (Metro JS bundle) and
// the simulator in Phase 4, not via Playwright browser snapshots.
// These entries are placeholders for the orchestrator to wire in later.
export const mobilePages: PageEntry[] = [
  { name: 'mobile-home', url: 'http://localhost:8081/' },
  { name: 'mobile-support', url: 'http://localhost:8081/support' },
  { name: 'mobile-appointments', url: 'http://localhost:8081/appointments' },
  { name: 'mobile-messages', url: 'http://localhost:8081/messages' },
];
