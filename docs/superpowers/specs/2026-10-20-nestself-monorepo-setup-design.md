# NestSelf monorepo setup — design

> **Superseded (2026-10-22):** the API data layer moved from Prisma 7 to Drizzle ORM with PostgreSQL row-level security (decision D-37 in docs/tasks/auth/auth-strategy.md). Prisma commands, schema paths and the generated client referenced below no longer exist; see apps/api/README.md.

Date: 2026-10-20
Status: approved for implementation under the stated assumptions (see "Decisions made without live confirmation")
Design source of truth: `docs/design-handoff/` (NestSelf Web Handoff v0.3, Forest & Mint, light, Onest)

## 1. Goal

Scaffold one pnpm + Turborepo monorepo that hosts five deployables and the shared packages they need, with the handoff design system implemented once as framework-independent tokens and consumed by React web, Next.js and React Native. Every app ships with the same design language, i18n in English and both Serbian scripts, and the checks the handoff demands.

This is a setup pass. It creates structure, token loading, local assets, reusable primitives, the marketing reference composition and representative component/pattern previews. It does not implement product features.

## 2. Scope and non-goals

In scope:

- Monorepo foundation: pnpm workspace, Turborepo task graph, shared TypeScript/ESLint/Prettier config, git.
- Design layer: tokens package, assets package, web UI package with Storybook and tests, native UI package.
- Five apps with shells, navigation, theming, i18n and one or more representative screens each.
- API scaffold: NestJS with Prisma schema skeleton, health endpoint, config validation, server-side role enforcement example. No business endpoints.
- Checks: token smoke check, locale parity check, component tests for keyboard, form errors and booking price clarity, Playwright screenshots at 390 px and 1440 px, lint, typecheck, build.

Out of scope (needs a separate brief):

- Real authentication provider, sessions, user directory sync.
- Bookings, payments, credits, cancellation rules, availability.
- Messaging delivery, notifications, video calls.
- HR reporting logic, suppression thresholds, privacy risk assessment.
- Content management, CMS, search.
- Deployment, hosting, CI pipelines, EAS builds, app store setup.
- Final brand identity, real expert photography, user testing, native accessibility audit.

Forbidden by the handoff and respected here: fake backend, payments, booked appointments, testimonials, client logos, availability promises, privacy guarantees, invented statistics, synthesized italics, palette hex literals inside components, stock people labelled as experts or customers, family eligibility implied by photographs.

## 3. Decisions made without live confirmation

The brief was detailed enough to proceed. These choices were mine and are easy to revisit:

| Topic | Decision | Alternative kept in mind |
|---|---|---|
| i18n library | i18next + react-i18next in all four frontends, shared catalogs | next-intl for the marketing app only (better App Router ergonomics, second message format) |
| Headless UI layer | Base UI (`@base-ui-components/react`) used directly, styled with Tailwind v4 utilities that map to semantic variables | shadcn/ui on Base UI (pre-styled, would need re-skinning to the handoff contracts) |
| React Native styling | Plain `StyleSheet` fed by a typed theme generated from tokens.json, via `ThemeProvider` and `useTheme` | NativeWind / Uniwind (Tailwind on native); revisit when their Tailwind v4 support is settled |
| React Native toolchain | Expo with Expo Router, Expo Go first, dev client later | Bare React Native |
| Component previews | Storybook inside `packages/ui` | A hand-rolled Vite playground |
| Serbian Cyrillic catalog | Generated from the hand-maintained Latin catalog by deterministic transliteration, committed, with a parity check | Two hand-maintained catalogs |
| Monorepo root | The existing `Nestself` folder becomes the repo root; the extracted handoff moves to `docs/design-handoff/` intact; the zip and the 9.7 MB standalone HTML stay at the root and are git-ignored | Keep the handoff folder at the root |
| Package consumption | Workspace packages export TypeScript source ("just-in-time" packages); apps compile them | Prebuilt `dist` with tsup |
| Test runner | Vitest everywhere, including the NestJS app | Jest for NestJS (its default) |

## 4. Repository layout

```
Nestself/                          git root, package name "nestself"
├─ apps/
│  ├─ marketing/                   Next.js App Router. Public, indexed, image-led.
│  ├─ workspace/                   Vite + React + TanStack Router/Query. Client organisations:
│  │                               employee, manager and HR surfaces in one app.
│  ├─ admin/                       Vite + React + TanStack Router/Query. NestSelf internal:
│  │                               experts and management back office.
│  ├─ mobile/                      Expo + Expo Router. Employee-first mirror of workspace.
│  └─ api/                         NestJS + Prisma + PostgreSQL. Scaffold only.
├─ packages/
│  ├─ tokens/                      tokens.json (source of truth), tokens.css, tailwind.css,
│  │                               native theme, theme switching helpers, smoke checks.
│  ├─ assets/                      fonts (woff2 + OFL, TTF for native), photos + manifest +
│  │                               credits, Phosphor SVG subset, responsive image build script.
│  ├─ ui/                          React web components on Base UI + Tailwind v4, Storybook, tests.
│  ├─ ui-native/                   React Native primitives + ThemeProvider.
│  ├─ i18n/                        Locale config, catalogs, typed keys, transliteration, parity check.
│  ├─ contracts/                   Zod schemas and types shared by API and clients (roles, locales, health).
│  ├─ api-client/                  Typed fetch wrapper and TanStack Query helpers.
│  ├─ sample-data/                 Clearly fictional fixtures and the sample-mode contract.
│  └─ config/                      tsconfig bases, ESLint flat presets, Prettier config.
├─ e2e/                            Playwright: 390 px and 1440 px screenshots, axe scans.
├─ docs/
│  ├─ design-handoff/              The handoff package, unchanged, index.html still opens.
│  ├─ superpowers/specs/           This document.
│  └─ superpowers/plans/           Implementation plan.
├─ docker-compose.yml              PostgreSQL 16 for the API.
├─ turbo.json  pnpm-workspace.yaml  package.json  .npmrc  .nvmrc  .gitignore
├─ README.md  CLAUDE.md  CREDITS.md
```

Package names use the `@nestself/` scope: `@nestself/tokens`, `@nestself/ui`, and so on.

## 5. Workspace and tooling foundation

- pnpm 10 workspace with the `catalog:` feature pinning React, TypeScript, Vitest, Tailwind and other shared versions in one place. pnpm 10 blocks dependency build scripts by default, so `onlyBuiltDependencies` lists the few that need them (esbuild, sharp, Prisma, SWC).
- Turborepo with tasks `build`, `dev` (persistent, uncached), `lint`, `typecheck`, `test`, `check` (tokens and locales) and `e2e`. `build` depends on `^build`. Outputs: `.next/**`, `dist/**`, `storybook-static/**`.
- TypeScript 5 with a shared strict base config, per-package `tsconfig.json`, `tsc --noEmit` for typecheck. No project references in the first pass.
- ESLint 9 flat config presets in `packages/config`: base, react (hooks, refresh, jsx-a11y), next, node. Prettier 3 with the Tailwind class-sorting plugin.
- Node version pinned in `.nvmrc` to the installed Node 24. `packageManager` field set to the installed pnpm 10.
- Exact versions are resolved during planning from the registry, not from memory, and pinned in the plan.

## 6. Design token architecture

The token layer is framework-independent and lives entirely in `packages/tokens`.

1. `tokens.json` is a verbatim copy of the handoff `data/tokens.json` (schema `nestself-design-spec/0.3`). It stays the source of truth for values and component contracts.
2. `tokens.css` is a verbatim copy of the handoff `styles/tokens.css`: `:root` primitives in rem, eight `html[data-palette][data-mode]` blocks, `html[data-font]` family switches, the reduced-motion override. The dark-mode shadow override from `styles.css` moves here because it is a token.
3. `tailwind.css` is a Tailwind v4 theme that maps utilities onto the live semantic variables with `@theme inline`, so `bg-primary` compiles to `background-color: var(--color-primary)` and follows palette and mode switches at runtime. Spacing, radius, shadow, motion, z-index, font family and the documented type roles are mapped the same way. Apps and the UI package never see a hex value.
4. `index.ts` exports the JSON as typed constants (`themes`, `space`, `radius`, `typography`, `layout`, `motion`, `iconMapping`, `requiredStates`, `patterns`) for tooling, tests and native.
5. `native.ts` derives the React Native theme: the same semantic colour keys per palette and mode, spacing in dp, radii, and the native type scale from the `ios` and `android` entries of each type role. These are starting values with platform adapters, as the handoff requires, not copied web CSS.
6. `theme.ts` is a tiny framework-free runtime: `applyTheme({ palette, mode, font })` sets the three `data-*` attributes on `<html>`, `readTheme()`, `persistTheme()`, and a `prefers-color-scheme` reader. Default is `forest`, `light`, `onest`. All four palettes, both modes and all five families stay selectable.

Semantic variable names are unchanged from the handoff: `--color-canvas`, `--color-surface`, `--color-raised`, `--color-tint`, `--color-text`, `--color-text-secondary`, `--color-border-subtle`, `--color-border-control`, `--color-primary`, `--color-primary-hover`, `--color-primary-pressed`, `--color-on-primary`, `--color-accent`, `--color-on-accent`, `--color-accent-soft`, `--color-focus`, `--color-disabled-surface`, `--color-disabled-text`, `--color-scrim`, and the four status pairs. The `semanticRoles` map in tokens.json is exported so older role names resolve to these.

Smoke check (`pnpm check:tokens`, also a Vitest test):

- The eight CSS blocks declare the same set of `--color-*` properties and every value equals the JSON `themes` entry.
- The 120 contrast pairs from the handoff report still pass their thresholds when recomputed with the WCAG sRGB formula.
- No raw hex colour literal exists in `packages/ui/src`, `packages/ui-native/src` or any app stylesheet. Only `tokens.css` may contain hex.
- No `@font-face` declares an italic style for Onest, and the global stylesheet sets `font-synthesis: none`.

## 7. Assets

`packages/assets` preserves the handoff material and adds production delivery.

- Fonts: the 19 woff2 files and five OFL licence files, unchanged. `fonts.css` maps each family to real weights 400, 600 and 700, plus the real italic 400 faces that exist (Commissioner, Nunito Sans, Fira Sans, Lato). Onest declares no italic. Native needs TTF or OTF, so Onest Regular, SemiBold and Bold TTFs are added from the upstream OFL repository with the licence beside them. If they cannot be fetched during setup, mobile falls back to the system font and the gap is reported.
- Photos: the ten optimised JPEGs, unchanged, plus `photos.json` carrying key, author, source URL, licence, focal point, status and usage text from `photo-sources.json`. A `sharp` script generates AVIF, WebP and JPEG variants at the documented widths and role crops, honouring the focal point, and writes a manifest with widths, heights, aspect ratios and credits. Next.js uses `next/image` with static imports and `object-position` from the focal point. Vite apps use the manifest. Expo uses `expo-image` with `contentPosition`.
- Icons: the original Phosphor SVG subset and MIT licence, kept for reference and for the native SVG pipeline. Web components use `@phosphor-icons/react` with the documented weights: Regular for controls, Fill for active navigation, Duotone for support categories. The `iconMapping` from tokens.json drives category icons.
- `CREDITS.md` at the repo root lists every photographer, font author and icon licence. The marketing site has a credits page with the same content.
- Alt text policy: informative images describe relevant context, decorative images have empty alt, functional images name the destination. Alt strings live in the i18n catalogs, not in the manifest.

## 8. Web UI package

`packages/ui` builds the documented contracts on Base UI primitives with Tailwind v4 classes that reference only semantic variables. Variants, sizes and density are explicit props, never implicit.

Primitives and components:

- Actions: `Button` (variant primary, secondary, ghost, danger, on-brand; size md, sm; `loading` keeps label and dimensions and blocks a second activation), `IconButton`, `TextLink`.
- Fields: `Field` (label, helper, error with `aria-describedby` and `aria-invalid`), `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch` (real programmatic state), `Chip` (toggle with `aria-pressed`), `ChipGroup`, `Fieldset`, `FormErrorSummary` (role alert, focusable, links to fields).
- Feedback: `Alert` (info, success, warning, danger), `Badge`, `Toast` with a live region, `Skeleton`, `StatusBlock` for the eight resilience states (empty, results, loading, offline, stale, permission, expired, protected), `VisuallyHidden`, `LiveRegion`.
- Navigation: `SkipLink`, `SiteHeader` (marketing), `AppShell` with `Sidebar` 248 px, `Topbar` 72 px and `BottomBar` 64 px, `NavItem` (Regular icon, Fill when active), `Tabs`, `Menu`.
- Dialogs: `Dialog` (focus containment, return focus, scrim, modal radius and shadow), `AlertDialog`, `Sheet` (sheet radius, touch padding).
- Tables: `Table` (56 px rows, 44 px compact for pointer-only, 16/12 cell padding, tabular lining numerals right-aligned), `DataList`, `MetricCard`, `ProtectedValue`.
- Patterns from the handoff: `CostBreakdown` (service price, employer part, employee part, time zone, change and cancellation terms, confirm label that includes the amount), `TimeSlotGrid`, `CoverageNotice`, `PrivacyAtPointOfUse`, `ChatThread` and `ChatComposer` (draft kept on failure, retry without duplicate), `EventRequestSummary`, `PhotoFigure` (responsive picture, focal point, credit), `Avatar` (initials fallback, circle only when small), `SampleDataBanner`.
- Typography: `Heading` and `Text` with the documented roles (display, editorialHeading, screenTitle, sectionTitle, bodyLarge, body, label, metadata, table, marketingHero with the fluid clamp).
- `Icon` and `CategoryIcon` wrappers over Phosphor with weight by context.
- `ThemeProvider` and `useTheme` over `@nestself/tokens/theme`, plus a dev-only `ThemeStudio` panel that switches palette, mode and font. It renders only in development builds. Production apps keep the default and expose no palette switcher.

Behaviour rules carried from the handoff: focus-visible outline 3 px with 2 px offset in `--color-focus`; min target 44 px on web and 48 px on coarse pointers; min-height means minimum; reduced motion zeroes durations; 320 px reflow without horizontal scroll; long Serbian strings must wrap, never clip.

Storybook: one story per component with its states (default, hover and pressed shown via explicit demo props, focus-visible, selected, disabled, read-only, loading, invalid, success), size and density variants; a toolbar that sets `data-palette`, `data-mode` and `data-font` on the preview `<html>`; the a11y addon on.

Tests (Vitest, Testing Library, jsdom, axe): Button keyboard activation and loading lock; Field error association and `FormErrorSummary` focus movement; Switch and Chip programmatic state; Dialog return focus; `CostBreakdown` renders all five facts and the confirm label contains the amount; `StatusBlock` variants; Icon weight rules; theme hook sets attributes and persists; axe has no violations on the composed form and dialog stories.

## 9. Native UI package

`packages/ui-native` mirrors the web API names with React Native primitives: `ThemeProvider`, `useTheme`, `Text` with the same role names and font scaling that never clips, `Button`, `Field` and `Input`, `Card`, `ListRow` (64 dp), `Badge`, `Alert`, `StatusBlock`, `Avatar`, `Icon` over `phosphor-react-native` with the same weight rules, and a `BottomTabs` configuration. Colours come from the native theme in `@nestself/tokens/native`. Reduced motion is read from `AccessibilityInfo`. Safe areas come from the platform, never a fixed inset.

## 10. Internationalisation

`packages/i18n` is the single i18n source for all four frontends.

- Locales: `en` (default), `sr-Latn`, `sr-Cyrl`. BCP 47 tags are used for `<html lang>`, `hreflang`, `Intl` formatting and font language hints.
- Runtime: i18next with react-i18next. Web apps use the browser language detector and a persisted preference. Next.js uses a `[locale]` route segment, a request-scoped server instance and a client provider. Expo uses `expo-localization`.
- Catalogs: JSON v4 with plural suffixes `_one`, `_few`, `_other`, which match Serbian plural categories. Namespaces: `common`, `marketing`, `workspace`, `admin`, `mobile`. Typed keys through `CustomTypeOptions`.
- Serbian Cyrillic is generated from Serbian Latin by a deterministic transliteration script with an exceptions list for digraph splits; the generated file is committed and `pnpm check:locales` fails when it is out of date or when any key is missing in any locale.
- Formatting helpers: `formatCurrency` (RSD and EUR), `formatDate` and `formatTime` in Europe/Belgrade, locale display names and script switcher labels.
- Content in this pass: all UI chrome strings and the marketing homepage copy exist in all three locales. Serbian translations are drafts and need a native reviewer before launch; the README says so.

## 11. Apps

### 11.1 `apps/marketing` (Next.js)

Purpose: the indexed public site with landing and marketing pages and calls to action. Density is generous and image-led.

- Routes under `/[locale]`: home, support, employers, privacy-model, credits, not-found. `robots.txt` and `sitemap.xml` with locale alternates. `generateMetadata` sets title, description, canonical and `hreflang`.
- Home reproduces the handoff composition and hierarchy: header with wordmark and four links, hero with eyebrow, two-line headline, lead paragraph, primary and secondary calls to action, the coverage note, one lead photo (family-grass, 3:2) and two supporting photos (friends-men, care-home); the support section with photo and three rows (psychological, legal, financial) using Duotone category icons; the three-step section; the life gallery (grandfather, family-play, couple-cooking); the employer band on the primary surface with the on-brand button and the family-autumn photo; the privacy block with its dialog; the footer with the credits link. Copy is the handoff copy. No testimonials, logos, statistics or availability claims.
- Fonts through `next/font/local` with the three Onest files, normal style only, `font-synthesis: none`. The other four families load only in development for the ThemeStudio.
- Images through `next/image` static imports: explicit dimensions, `sizes`, `priority` on the hero lead, lazy below the fold, `object-position` from the focal point, AVIF and WebP automatically.
- Theme: default forest, light. Dark mode follows the token layer and is reachable from the dev ThemeStudio only in this pass.

### 11.2 `apps/workspace` (Vite SPA)

Purpose: the client-organisation app. One app, three surfaces separated by route layouts and role gates in the UI, with the server as the real gate.

- Root providers: QueryClient, i18n, Theme, Toast, Session stub, SampleData banner.
- Route tree (file-based): `_authenticated` layout with the AppShell; employee routes `/` home, `/support`, `/support/$area` (psychological, legal, financial), `/channels`, `/channels/$channelId`, `/polls`, `/appointments`, `/messages`, `/messages/$threadId`, `/settings`; `_manager` layout under `/manage` with `team`, `polls/new`, `events/new`; `_hr` layout under `/hr` with index, `eligibility`, `reports`, `events`. `beforeLoad` reads the role from router context and redirects to a permission `StatusBlock` when it does not match.
- Representative screens built in this pass: employee home (greeting, category cards with Duotone icons, next appointment card, channel digest, at most one photo), support area with the booking demonstration (advisor, time grid with time zone, cost breakdown, change terms dialog, local-only confirmation that states no appointment or payment was created), a channel feed with sample posts, the HR overview with metric cards and a protected breakdown. Every other route renders its title and an empty `StatusBlock` with sample-mode labelling.
- Density: task-focused. No decorative photography on HR or transactional screens.
- API wiring: `@nestself/api-client` calls `GET /api/health` through the Vite dev proxy to prove the path; nothing else.

### 11.3 `apps/admin` (Vite SPA)

Purpose: NestSelf internal back office for experts and management.

- Routes: `/` overview, `/experts`, `/experts/$expertId`, `/organizations`, `/organizations/$orgId`, `/content`, `/event-requests`, `/settings`.
- Representative screens: the experts directory as a Table with the 56 px and 44 px densities and initials avatars (real portraits only for approved experts, so none here), the organisations list, an overview of status blocks. HR-dense content width 1440 px.

### 11.4 `apps/mobile` (Expo)

Purpose: the employee experience on iOS and Android, mirroring workspace.

- Expo Router: root layout loads Onest, Theme and i18n; tab group with Home, Support, Appointments, Messages; stack screens for `support/[area]`, `channels/[id]`, `settings`.
- Representative screens: Home as in the handoff phone demonstration (initials avatar, next appointment card, bottom tabs with Fill-weight active icon), and the booking demonstration with the cost breakdown. Everything else is a titled empty state.
- Runs in Expo Go on the iOS simulator. Watchman is broken on this machine, so Metro uses polling; this is documented.

### 11.5 `apps/api` (NestJS)

Purpose: the backend scaffold with the structure, configuration and enforcement pattern in place, and no business logic.

- Modules: `ConfigModule` with a zod-validated environment, `PrismaModule`, `HealthModule` (`GET /api/health` with a database indicator), `AuthModule` skeleton (a JWT guard placeholder, `@Roles()` decorator, `RolesGuard` that resolves the caller's membership in the organisation named in the route), and one example `ProgrammeController` exposing `GET /api/orgs/:orgId/programme` that returns a static placeholder and exists only to demonstrate and test server-side role enforcement. OpenAPI document served in development and exportable for client generation.
- Prisma schema skeleton: `Organization`, `Team`, `User`, `Membership` (org-scoped role: employee, manager, hr_admin), `PlatformRole` on `User` (expert, operations, admin), `Channel` (org or team scope), `Post`, `Poll`, `PollOption`, `PollVote`, `Expert` (specialty psychological, legal, financial), `ContentItem` (area, locale), `EventRequest`. No `Appointment`, `Payment` or `Message` models: those need contractual rules first.
- PostgreSQL 16 in Docker Compose with a health check. `.env.example`. One initial migration. A seed that refuses to run when `NODE_ENV` is production.
- Tests: `RolesGuard` denies an employee and allows an HR admin; health endpoint responds.

## 12. Roles and access model

`packages/contracts` defines the enums once: `OrgRole = employee | manager | hr_admin` and `PlatformRole = expert | operations | admin`, plus `Locale`, `Palette`, `Mode`, `FontFamily`, `SupportArea = psychological | legal | financial` and the health response schema. Clients use them for UI gating and navigation. The API uses them for enforcement. The handoff access matrix (employee, assigned advisor, HR, operations) is documented in the contracts package as the target model and is not claimed as implemented.

## 13. Sample data separation

`packages/sample-data` holds fictional fixtures with the `SAMPLE_` prefix and the names already used in the handoff (for example the advisor Milica Ristić, the Novi Sad event request, the 500 eligible employees). Apps run in sample mode when `VITE_DATA_SOURCE=sample` or `EXPO_PUBLIC_DATA_SOURCE=sample`, and then render `SampleDataBanner` on every screen. Production builds do not import the fixtures. The API seed uses the same fixtures and refuses to run in production.

## 14. Accessibility and resilience requirements

| Requirement | Where it is implemented | How it is checked |
|---|---|---|
| Keyboard and focus-visible | UI primitives, global focus style from tokens | Component tests, Storybook a11y, Playwright |
| Form errors associated and announced | `Field`, `FormErrorSummary`, live regions | Component tests |
| Dialog focus containment and return | Base UI Dialog | Component test for return focus, real-browser check |
| Reduced motion | tokens.css override, native `AccessibilityInfo` | Token smoke check |
| 320 px reflow | AppShell, grids, tables with scroll wrappers | Playwright at 320 px and 390 px |
| Text scaling | rem units on web, font scaling on native | Playwright with 200 % zoom on one screen, manual on simulator |
| Both scripts and long content | Catalogs in sr-Latn and sr-Cyrl, no fixed heights | Locale parity check, Playwright in sr-Cyrl |
| Booking price clarity | `CostBreakdown` | Component test |
| Protected is not zero, offline is not empty | `StatusBlock` protected and offline variants | Component tests |

## 15. Checks and verification plan

Root scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm check` (tokens and locales), `pnpm e2e`.

Playwright at the root drives the three web apps' dev servers and captures marketing home, workspace home, workspace booking, admin experts at 390 by 844 and 1440 by 900, in the default theme and in forest dark, in English and in sr-Cyrl, and runs an axe scan on each. The screenshots are reviewed in this session before completion and kept under `e2e/__screenshots__`.

Done means: install, lint, typecheck, test, build and check all pass from a clean checkout; the e2e screenshots exist and were viewed; the mobile app starts on the iOS simulator; the API health endpoint answers against the Docker database.

## 16. Documentation and git

- Root `README.md`: what each app and package is, how to run everything, the sample-mode flag, the check commands, the known gaps.
- Root `CLAUDE.md`: repo conventions and a pointer to `docs/design-handoff/CLAUDE.md` as the design constraints that still apply.
- `CREDITS.md`: photographers, font authors and icon licences.
- git initialised at the root. The zip and the standalone HTML are ignored. Commits per phase.

## 17. Explicitly unimplemented after this pass

- Authentication and session management; the session is a stub that picks a sample role.
- Any real booking, payment, message, poll vote, channel post or report query.
- Expert portraits; initials are used.
- Crisis pathway, video calling, export and print, contractual coverage and cancellation rules.
- Native-device typography and screen reader verification beyond a simulator start.
- Production image CDN, caching policy and WebP/AVIF quality review by a person.
- Final Serbian copy review by a native speaker.

## 18. Risks and mitigations

| Risk | Mitigation |
|---|---|
| pnpm 10 blocks postinstall scripts (Prisma, esbuild, sharp, SWC) | `onlyBuiltDependencies` in `pnpm-workspace.yaml` from the start |
| Expo in a pnpm workspace needs hoisting or Metro configuration | Follow the current Expo monorepo guidance; verify Metro resolves workspace packages before building screens |
| React version mismatch between Expo and the web apps | Pin React per app from the catalog if Expo's SDK requires a different patch line |
| woff2 cannot be loaded by React Native | TTF files for Onest from the upstream OFL source, licence preserved |
| Storybook, Tailwind v4 and React 19 configuration friction | Use the latest Storybook with the Vite builder and the official Tailwind v4 setup; keep the preview CSS minimal |
| Broken watchman slows Metro | Polling fallback; documented |
| Serbian transliteration edge cases | Exceptions list and a parity check; native review before launch |
