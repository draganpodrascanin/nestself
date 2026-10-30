# Phase 0 spikes

Scripts here run with the API workspace's dependencies:

```bash
pnpm --filter @nestself/api exec tsx scripts/spikes/<script>.ts
```

| Spike | Script | Status |
|---|---|---|
| SPIKE-01 email OTP via `AdminInitiateAuth` (`USER_AUTH`, `EMAIL_OTP`) without managed login | `spike-01-email-otp.ts` | pending: needs the dev pool coordinates in `apps/api/.env` |
| SPIKE-02 custom Redis session service on NestJS 12 / Express 5 | proven by `apps/api/src/session` and its integration tests | see `apps/api/docs/auth-core.md` |
| SPIKE-03 Socket.IO through CloudFront with ALB stickiness | n/a | pending: needs a staging deployment |
| SPIKE-04 Prisma 7 org-scoping client extension | n/a | Superseded by D-37 (Drizzle + RLS) |

## NS-CALLS-01 Chime SDK spikes (T-CW-0.4)

`spike-cw-01` to `spike-cw-08` answer the questions of section 8 of `docs/tasks/calls-webinars/02-decisions.md`. Prerequisites, the running order, the result tables and the binding change per outcome are in `docs/tasks/calls-webinars/research/07-spikes.md`. Shared code: `lib.ts` (region and profile guards, cleanup registry, meeting and pipeline helpers) and `browser-harness.ts` (local page, Chime SDK browser bundle, Playwright with fake media). Every script accepts `--help`, which prints its options without calling AWS.
