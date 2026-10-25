/**
 * Starts the API for the consultation journeys (`playwright.calls.config.ts`):
 *
 * 1. recreates the journeys' own database (never the `nestself` development
 *    database; `servers.mjs` names it and only `nestself_test_*` or
 *    `nestself_e2e_*` names are accepted), applies the migrations and runs
 *    the sample-data seed, so every run starts from the current fixtures
 *    (set E2E_CALLS_KEEP_DATABASE=true to keep the data instead);
 * 2. builds the API (`nest build`; skip with E2E_CALLS_SKIP_API_BUILD=true);
 * 3. runs `apps/api/dist/main.js` with stub authentication (fixed email code
 *    123456), insecure-dev cookies and the in-process `FakeVideoProvider`
 *    (`VIDEO_PROVIDER=none`), on the journeys' port, database and Redis index,
 *    trusting one proxy hop so each browser context counts as its own client.
 *
 * The nightly smoke workflow sets E2E_CALLS_VIDEO_PROVIDER=chime and the
 * Chime variables instead (D-CW-33).
 */
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { API_PORT, ADMIN_URL, DATABASE_URL, REDIS_URL, WORKSPACE_URL } from './servers.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const apiDir = fileURLToPath(new URL('../../apps/api', import.meta.url));

function run(command, args, extraEnv = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
}

function ensureDatabase() {
  const url = new URL(DATABASE_URL);
  const name = url.pathname.slice(1);
  if (!/^nestself_(test|e2e)_[a-z0-9_]+$/.test(name)) {
    throw new Error(`Refusing to prepare ${name}: the journeys only use a nestself_test_* or nestself_e2e_* database`);
  }
  const admin = new URL(DATABASE_URL);
  admin.pathname = '/postgres';
  const exists = execFileSync('psql', [admin.toString(), '-Atc', `SELECT 1 FROM pg_database WHERE datname = '${name}'`], {
    encoding: 'utf8',
  }).trim();
  const keep = process.env.E2E_CALLS_KEEP_DATABASE === 'true';
  if (exists === '1' && !keep) run('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `DROP DATABASE ${name} WITH (FORCE)`]);
  if (exists !== '1' || !keep) run('psql', [admin.toString(), '-v', 'ON_ERROR_STOP=1', '-c', `CREATE DATABASE ${name}`]);
  run('pnpm', ['--filter', '@nestself/api', 'db:migrate'], { DATABASE_URL });
  run('pnpm', ['--filter', '@nestself/api', 'db:seed'], { DATABASE_URL, NODE_ENV: 'development' });
}

ensureDatabase();
if (process.env.E2E_CALLS_SKIP_API_BUILD !== 'true') run('pnpm', ['--filter', '@nestself/api', 'build']);

const provider = process.env.E2E_CALLS_VIDEO_PROVIDER || 'none';
const api = spawn('node', ['--enable-source-maps', 'dist/main.js'], {
  cwd: apiDir,
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(API_PORT),
    DATABASE_URL,
    REDIS_URL,
    AUTH_MODE: 'stub',
    FAKE_IDP_FIXED_OTP: '123456',
    SESSION_COOKIE_INSECURE_DEV: 'true',
    JWT_SECRET: process.env.JWT_SECRET || 'e2e-calls-only-secret-long-enough-for-stub-mode',
    VIDEO_PROVIDER: provider,
    // The API rate-limits per client address (60 a minute). Every browser of the suite runs on this
    // machine, so each context sends its own X-Forwarded-For (journey.ts) and the API trusts the proxy hop.
    TRUST_PROXY_HOPS: '1',
    WORKSPACE_URL,
    ADMIN_URL,
  },
});

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => api.kill(signal));
api.on('exit', (code) => process.exit(code ?? 0));
