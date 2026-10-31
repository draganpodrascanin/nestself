# NestSelf

A pnpm + Turborepo monorepo for the NestSelf employee wellbeing platform. Five apps share ten workspace packages built around a framework-independent design token layer, i18n in English and both Serbian scripts, and a set of automated checks.

This is a setup pass. It creates project structure, token loading, local assets, reusable primitives, representative screens and component previews. It does not implement product features.

## Apps

| Directory        | Package               | Description                                                                | Port         |
| ---------------- | --------------------- | -------------------------------------------------------------------------- | ------------ |
| `apps/marketing` | `@nestself/marketing` | Next.js 16 App Router public site, image-led, locale routes                | 3000         |
| `apps/workspace` | `@nestself/workspace` | Vite SPA with TanStack Router, employee/manager/HR surfaces                | 5173         |
| `apps/admin`     | `@nestself/admin`     | Vite SPA with TanStack Router, NestSelf back office                        | 5174         |
| `apps/mobile`    | `@nestself/mobile`    | Expo SDK 58, Expo Router, tabs for Home/Support/Appointments/Messages      | 8081 (Metro) |
| `apps/api`       | `@nestself/api`       | NestJS 12 with Drizzle ORM schema, PostgreSQL row-level security, health endpoint, grant-based authorization | 4000         |

## Packages

| Directory                    | Package                       | Purpose                                                                  |
| ---------------------------- | ----------------------------- | ------------------------------------------------------------------------ |
| `packages/tokens`            | `@nestself/tokens`            | `tokens.json`, `tokens.css`, `tailwind.css`, native theme, theme helpers |
| `packages/assets`            | `@nestself/assets`            | Fonts (woff2 + TTF + OFL), photos, Phosphor SVG subset, image pipeline   |
| `packages/ui`                | `@nestself/ui`                | React web components on Base UI + Tailwind, Storybook, tests             |
| `packages/ui-native`         | `@nestself/ui-native`         | React Native primitives + ThemeProvider                                  |
| `packages/i18n`              | `@nestself/i18n`              | Locale config, catalogs, transliteration, parity check, Intl helpers     |
| `packages/contracts`         | `@nestself/contracts`         | Zod schemas: roles, locales, support areas, health, access model         |
| `packages/api-client`        | `@nestself/api-client`        | Typed fetch wrapper + TanStack Query options                             |
| `packages/sample-data`       | `@nestself/sample-data`       | Fictional fixtures + sample-mode helpers                                 |
| `packages/typescript-config` | `@nestself/typescript-config` | Shared tsconfig base presets (vite-react, nextjs, nestjs, react-native)  |
| `packages/eslint-config`     | `@nestself/eslint-config`     | ESLint 9 flat config presets (base, react, next, node)                   |

## Prerequisites

- **Node 24** (pinned in `.nvmrc`; enable with `nvm use` or `fnm use`)
- **pnpm 10.10** via corepack (`corepack enable` if not already active)
- **Docker** for the API database (Postgres 16 via Docker Compose), or any PostgreSQL instance with the connection string in `DATABASE_URL`

## First run

```bash
pnpm install
pnpm images:build        # sharp pipeline, takes several minutes
pnpm dev                 # starts all apps; images:sync runs automatically
```

`pnpm images:build` generates responsive image variants from the source photos. The `images:sync` Turbo task copies them into each app's `public/images/` and runs automatically as a dependency of `dev` and `build`.

## Per-app commands

### Marketing (port 3000)

```bash
pnpm --filter @nestself/marketing dev
```

### Workspace (port 5173)

```bash
pnpm --filter @nestself/workspace dev
```

### Admin (port 5174)

```bash
pnpm --filter @nestself/admin dev
```

### Mobile (Metro port 8081)

```bash
pnpm --filter @nestself/mobile start
```

Press `i` to open in the iOS simulator via Expo Go. Watchman is optional; Metro falls back to polling when it is not installed. The native fonts are the three Onest TTF files (Regular, SemiBold, Bold) loaded via `expo-font`.

### API (port 4000)

```bash
pnpm --filter @nestself/api dev
```

The API uses the `tsc` Nest builder. SWC needs `@swc/cli`, which is not installed.

### Storybook (port 6006)

```bash
pnpm storybook
```

## API database

Start Postgres and Redis with Docker Compose:

```bash
pnpm db:up        # Postgres 17 + Redis 7 in the background
pnpm db:down      # stop and remove the containers
```

Or point `DATABASE_URL` in `apps/api/.env` to any running PostgreSQL instance (see `.env.example` for the default connection string).

Run the initial migration and seed:

```bash
pnpm --filter @nestself/api db:migrate
pnpm --filter @nestself/api db:seed
```

The seed script refuses to run when `NODE_ENV` is `production`.

## Running the API in Docker

To build and run the API as a container alongside Postgres and Redis, copy `docker/api.env.example` to `docker/api.env`, set a real `JWT_SECRET`, and run `pnpm docker:api`. This builds the multi-stage Dockerfile at `apps/api/Dockerfile`, runs the Drizzle migrations automatically, and starts the API on port 4000. Redis is included for BullMQ job queues that will be added later. See `docker/README.md` for the full service breakdown and CI build instructions.

## Sample mode

Apps default to sample mode in development. The environment variable `VITE_DATA_SOURCE` (workspace and admin) or `EXPO_PUBLIC_DATA_SOURCE` (mobile) controls this. When set to `sample`, the app renders fictional fixtures from `@nestself/sample-data` and shows a sample-data banner on every screen. See `docs/environment.md` for all variables.

## Checks

Run the full verification suite:

```bash
pnpm verify     # lint, lint:root, typecheck, test, check, build
```

Individual commands:

```bash
pnpm lint        # ESLint across all packages
pnpm typecheck   # tsc --noEmit across all packages
pnpm test        # Vitest across all packages
pnpm check       # token smoke, locale parity, motion contract, content and web parity checks
pnpm build       # production builds
```

### End-to-end tests

```bash
pnpm e2e          # Playwright: screenshots at 390/1440, axe, 320 px reflow
pnpm e2e:update   # regenerate screenshot baselines
```

See `e2e/README.md` for details on the Playwright projects, helper utilities and the `snap.mjs` ad-hoc screenshot tool.

## Internationalisation

Three locales: `en`, `sr-Latn` (Serbian Latin) and `sr-Cyrl` (Serbian Cyrillic). The Latin catalogs are drafts pending a native speaker review. Cyrillic catalogs are generated by deterministic transliteration:

```bash
pnpm --filter @nestself/i18n build:cyrillic
```

The locale parity check (`pnpm check`) verifies key completeness, placeholder consistency and Cyrillic freshness.

## Known gaps

These items are not implemented in this setup pass:

- Authentication and session management; the session is a stub that picks a sample role.
- Real booking, payment, message, poll vote, channel post or report query.
- Expert portraits; initials are used.
- Crisis pathway, video calling, export and print, contractual coverage and cancellation rules.
- Native-device typography and screen reader verification beyond a simulator start.
- Production image CDN, caching policy and WebP/AVIF quality review by a person.
- Final Serbian copy review by a native speaker.
- No CI pipeline.
- No Dockerfile for the API.
- SWC builder not enabled (needs `@swc/cli`).
- Android emulator untested.
- iOS simulator run only verified for the home screen.

## Design decisions

See `docs/superpowers/specs/2026-10-20-nestself-monorepo-setup-design.md` for the full decisions log and architecture rationale.

## Marketing site content

The public site (`apps/marketing`) keeps page copy, articles, webinars, guides and wellbeing check-ins as files under `apps/marketing/content` in `en`, `sr-Latn` and `hu`; `sr-Cyrl` is generated with `pnpm --filter @nestself/marketing content:cyrillic`. English is the authoring source of content files; Serbian Latin is the default served language. `pnpm check` validates every content file, cover key, translation parity and Cyrillic freshness. Lead forms forward to the API (`API_URL`); see `apps/marketing/README.md`.
