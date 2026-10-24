/**
 * Ports and base URLs for the local servers the Playwright suites use.
 *
 * Defaults match the main checkout. A second git worktree overrides them with
 * `E2E_*_PORT` so both can run side by side (see docs/environment.md,
 * "Running a second worktree").
 */
function port(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    throw new Error(`${name} must be a port number, got "${raw}"`);
  }
  return value;
}

export const API_PORT = port('E2E_API_PORT', 4000);
export const WORKSPACE_PORT = port('E2E_WORKSPACE_PORT', 5173);
export const ADMIN_PORT = port('E2E_ADMIN_PORT', 5174);
export const MARKETING_PORT = port('E2E_MARKETING_PORT', 3000);
export const STORYBOOK_PORT = port('E2E_STORYBOOK_PORT', 6106);

export const API_URL = `http://localhost:${API_PORT}`;
export const WORKSPACE_URL = `http://localhost:${WORKSPACE_PORT}`;
export const ADMIN_URL = `http://localhost:${ADMIN_PORT}`;
export const MARKETING_URL = `http://localhost:${MARKETING_PORT}`;
export const STORYBOOK_URL = `http://localhost:${STORYBOOK_PORT}`;
