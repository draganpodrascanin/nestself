# NestSelf repository conventions

## Workspace packages are JIT (just-in-time)

Packages under `packages/` export TypeScript source directly. Each app's bundler compiles them at build time. There is no prebuilt `dist` step for workspace packages (the `@nestself/assets` build is an image pipeline, not a TS compilation).

## Dependency versions live in the catalog

All shared dependency versions are pinned once in the `catalog:` section of `pnpm-workspace.yaml`. Individual `package.json` files reference `"catalog:"` instead of a version string. When adding or upgrading a dependency, update the catalog entry, not the consuming package.

## Colour rule

Component and app code references semantic tokens only (`bg-primary`, `text-text-secondary`, `border-border-control`, `var(--color-focus)` and so on). No hex colour literal anywhere outside `packages/tokens/tokens.css`, `packages/tokens/tokens.json` and the token smoke test. The smoke check (`pnpm check`) scans `packages/ui/src`, `packages/ui-native/src` and `apps/*/src` and fails on a violation.

## Content rule

No client logos, invented statistics, availability promises ("24/7"), response-time promises, privacy guarantees, fake bookings, payments or messages. Interactive demonstrations state that nothing was created. Stock and generated people are never named experts or customers. Sample data is flagged and banner-labelled in the apps.

Marketing-site exceptions agreed on 2026-10-21: testimonials are placeholders from `SAMPLE_TESTIMONIALS` in `packages/sample-data` (fictional first names and roles, anonymised company descriptors, `placeholder: true`, rendered with `data-placeholder="true"`) until real consented quotes exist; the contact email defaults to `hello@nestself.example` until `NEXT_PUBLIC_CONTACT_EMAIL` is set; legal pages carry bracketed company-identifier placeholders. All three are launch-checklist items in the marketing spec, not production content. Third-party benchmarks may be quoted only with their source named. Wellbeing check-ins are never presented as diagnoses and always show the disclaimer and crisis block; the WHO-5 is not used (licence).

## Sample-data rule

Fictional fixtures live in `packages/sample-data` with the `SAMPLE_` prefix. Apps run in sample mode when `VITE_DATA_SOURCE=sample` or `EXPO_PUBLIC_DATA_SOURCE=sample` (the default in development). The `SampleDataBanner` appears on every screen in sample mode. The API seed uses the same fixtures and refuses to run when `NODE_ENV` is `production`.

## Server-side role enforcement

Authorization is enforced on the server by two global guards in `apps/api`: `AuthenticationGuard` resolves the `Principal` from the session cookie or bearer token, and `AuthorizationGuard` evaluates `@Authorize(action, resourceResolver)` metadata with the pure `authorize()` engine over grants, assignments and the org tree (`docs/tasks/auth/auth-strategy.md`, section 4). Every controller route carries `@Public()`, `@Authenticated()` or `@Authorize()`; the default-deny CI test fails otherwise. Tenant tables also carry PostgreSQL row-level security policies as defense in depth. The legacy role enums (`employee`, `manager`, `hr_admin`, `expert`, `operations`, `admin`) are deprecated and only feed the sample seed until phase 2. UI gating (hiding routes, disabling controls) is a convenience, not access control. Do not rely on frontend checks for authorization.

## No installs during parallel work

After the initial `pnpm install`, no worker runs `pnpm install`, `pnpm add`, `pnpm dlx`, `npx`, `expo install`, `nest new`, `create-*`, `storybook init` or anything else that touches `pnpm-lock.yaml` or `node_modules`. If a dependency is missing, finish everything else and list it as a missing dependency.

## Where tests live

- **Unit and component tests**: colocated next to the source file as `*.test.ts` or `*.test.tsx`, run by Vitest (`pnpm test`).
- **End-to-end tests**: in `e2e/` at the repo root, run by Playwright (`pnpm e2e`). See `e2e/README.md`.
- **Check scripts** (token smoke, locale parity): run by `pnpm check`.

## How to add a component

1. Create the component file in `packages/ui/src/components/` (web) or `packages/ui-native/src/components/` (native).
2. Export it from the package's `src/index.ts`.
3. Use only semantic token references for colours -- no hex literals.
4. Write a colocated test (`*.test.tsx`) covering keyboard interaction, error states and any accessibility contract.
5. For web components, add a Storybook story in the same directory.
6. Run `pnpm --filter <package> lint && pnpm --filter <package> typecheck && pnpm --filter <package> test` before committing.

## How to add a route

1. Create the route file under the app's route directory (file-based routing for TanStack Router in workspace and admin, `app/` directory for Next.js marketing, `app/(tabs)/` for Expo Router mobile).
2. Use the app's existing layout and provider wrappers.
3. For workspace and admin, `beforeLoad` checks the role from router context if the route is role-gated.
4. Use sample data from `@nestself/sample-data` when the app is in sample mode; do not inline fictional data in the route module.
5. Add translations to the appropriate namespace in `packages/i18n/locales/`.

## AWS and CDK

The machine's `[default]` AWS profile points at an unrelated account with no permissions here, and using it is the quickest way to lose an hour: the errors name the correct pool id but the wrong account, so they read like missing IAM permissions on the pool rather than wrong credentials.

1. **Never `export AWS_PROFILE` globally.** A `chpwd` hook in `~/.zshrc` sets `AWS_PROFILE=nestself-dev`, `AWS_REGION=eu-central-1` and `AWS_ACCOUNT_DEV` inside this repository and restores the previous values on the way out. Before any `aws` or `cdk` command, confirm with `aws sts get-caller-identity`: the account must be `634972095709`. A global export would silently redirect every other project on the machine.
2. **The region is `eu-central-1` and is not negotiable** (data residency). `bin/app.ts` hard-codes it for the stacks, but the CLI reads `AWS_REGION` for bootstrap, deploy and `env-from-outputs.mjs`, and that script passes neither `--region` nor `--profile`: with the wrong ambient region it prints warnings and appends empty variables instead of failing.
3. **Always pass stage and account**: `-c stage=dev -c account=$AWS_ACCOUNT_DEV`. Never combine `-c platform=true` with `stage=dev`; `bin/app.ts` throws on purpose, dev is Cognito only.
4. **The dev pool already exists.** Account `634972095709`, pool `eu-central-1_g6OGYONQ0`, hosted domain `nestself-dev`, stacks `CDKToolkit` and `NestSelf-dev-Auth`, first deployed 2026-10-24. Redeploy the stack; never create a second pool by hand.
5. **After any change to `auth-stack.ts`**, re-run `node infra/cdk/scripts/env-from-outputs.mjs dev` and replace the `COGNITO_*` block in `apps/api/.env`.
6. **Pool usernames are email addresses** and **the email OTP code is eight digits**. Both follow from the stack's own configuration and are explained in `docs/auth/implementation.md` section 17.1. Use `EMAIL_OTP_MIN_LENGTH` / `EMAIL_OTP_MAX_LENGTH` from `@nestself/contracts`; never hard-code a code length.

`CDK-setup.md` is the step-by-step account setup; `infra/cdk/README.md` is the stack reference.

## Error states must be visible in the UI

Every failure the user caused must put a readable message on screen. A `console.error`, a rejected promise or a status code in the network tab is not an error state: if the only way to learn that something failed is to open devtools, the feature is not finished.

1. **The screen that made the call renders the failure.** Forms use `FormErrorSummary` plus the field-level message; everything else uses an alert or a toast from `@nestself/ui`. Never a silent no-op.
2. **A component that raises errors upward must also accept them back.** Taking an `onError` prop without a matching `error?: string | null` prop that is rendered is the bug this rule exists for: it swallowed every sign-in failure on four screens in each web app until 2026-10-24, so a wrong one-time code showed nothing but a 401 in the console.
3. **Map API codes to translated copy** in `packages/i18n/locales/` for all four locales. Do not render the API's raw `message`: it is English and written for developers.
4. **Unknown codes still render something.** Fall back to `error.unknown` rather than letting the branch fall through.
5. **Prove it.** A screen that can fail needs a test that asserts the message appears, not only that the call was made.

## Serbian Cyrillic catalogs

Cyrillic catalogs are generated from the Latin source by transliteration (`pnpm --filter @nestself/i18n build:cyrillic`) and checked by `pnpm check`. Do not edit `sr-Cyrl` JSON files by hand. The Latin catalogs are drafts pending a native speaker review.

Design constraints in `docs/design-handoff/CLAUDE.md` still apply.
