# @nestself/api

NestJS 12 API server with Prisma 7 schema skeleton and server-side role enforcement.

## Run instructions

```bash
# Generate Prisma client
pnpm --filter @nestself/api prisma:generate

# Start in development mode
pnpm --filter @nestself/api dev

# Build for production
pnpm --filter @nestself/api build

# Run tests
pnpm --filter @nestself/api test

# Run migrations (requires a running database)
pnpm --filter @nestself/api prisma:migrate

# Seed the database with sample data
pnpm --filter @nestself/api prisma:seed
```

The server listens on port 4000 by default. Copy `.env.example` to `.env` and adjust values.

## Role enforcement

The API enforces roles on the server side using two guards applied globally:

- **AuthGuard**: verifies JWT tokens from the `Authorization: Bearer <token>` header. Routes decorated with `@Public()` skip authentication. Invalid or missing tokens result in 401.

- **RolesGuard**: when a route is decorated with `@Roles(...)`, the guard checks:
  1. If the user has a matching **platform role** (expert, operations, admin), access is granted regardless of organisation.
  2. Otherwise, if `@OrgParam('orgId')` is set, the guard looks up the user's membership in that organisation and checks if their **org role** (employee, manager, hr_admin) matches one of the required roles.
  3. If neither condition is met, the request is denied with 403.
  4. Routes without `@Roles()` metadata allow any authenticated user.

Role values use lower-case strings from `@nestself/contracts` (employee, manager, hr_admin, expert, operations, admin). Prisma enum values are UPPER_CASE and mapped via a small adapter in `src/auth/types.ts`.

## What is deliberately missing

- **Appointments, payments, messages, credits**: these require contractual rules and a privacy risk assessment (spec section 17).
- **Database migrations**: the orchestrator runs migrations in Phase 4 against a temporary database. The schema is defined but no migration files exist yet.
- **Real authentication flow**: the AuthGuard verifies JWTs but no login/registration endpoints exist. These will be added in a later phase.
- **Analytics, testimonials, logos, statistics**: not included per project content rules.
