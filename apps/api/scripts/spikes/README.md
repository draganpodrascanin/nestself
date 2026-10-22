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
