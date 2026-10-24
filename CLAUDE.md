# NestSelf repository conventions

## Workspace packages are JIT (just-in-time)

Packages under `packages/` export TypeScript source directly. Each app's bundler compiles them at build time. There is no prebuilt `dist` step for workspace packages (the `@nestself/assets` build is an image pipeline, not a TS compilation).

## Dependency versions live in the catalog

All shared dependency versions are pinned once in the `catalog:` section of `pnpm-workspace.yaml`. Individual `package.json` files reference `"catalog:"` instead of a version string. When adding or upgrading a dependency, update the catalog entry, not the consuming package.

## Colour rule

Component and app code references semantic tokens only (`bg-primary`, `text-text-secondary`, `border-border-control`, `var(--color-focus)` and so on). No hex colour literal anywhere outside `packages/tokens/tokens.css`, `packages/tokens/tokens.json` and the token smoke test. The smoke check (`pnpm check`) scans `packages/ui/src`, `packages/ui-native/src` and `apps/*/src` and fails on a violation.

## Motion rule

Anything that appears, disappears, pops out, slides or expands is animated, on the way in and on the way out. That covers dialogs, alert dialogs, sheets and drawers, menus and dropdowns, selects, popovers, tooltips, comboboxes, toasts, accordions and collapsibles, the mobile navigation and any other disclosure, and indicators that move between positions (tabs). An exit is never an instant unmount, and a popout is never shown or hidden by toggling `display` alone.

1. **Use Motion (`motion`, formerly Framer Motion) through `@nestself/ui`.** Components import `m`, `AnimatePresence`, `MotionFeatures` and `useMotionPreset` from `packages/ui/src/motion`; apps import the same names from `@nestself/ui` and never from `motion/*` or `framer-motion` (ESLint and `pnpm check` fail otherwise). Wrap animated parts in `MotionFeatures` (LazyMotion; `MotionLayoutFeatures` only where `layout` is needed), never the full `motion.*` component.
2. **Base UI popups follow Base UI's Motion pattern.** Control `open`, put `<X.Portal keepMounted>` inside `<AnimatePresence>`, and compose `Popup` and `Backdrop` with `render={<m.div {...useMotionPreset('dialog')} />}`. `Select` always renders its portal and animates by `open` (see `Field.tsx`), because Base UI mounts the closed popup early for typeahead and keeps it mounted. Accordion and Collapsible panels are the exception: Base UI measures them, so they transition `height` from `--accordion-panel-height` (or `--collapsible-panel-height`) with `data-starting-style` / `data-ending-style` on the tokens. Hover, press, colour, switch thumbs, carets and tab indicators on always-mounted elements use CSS transitions on the tokens.
3. **Timing comes from the tokens only:** fast 120 ms (hover, press, colour, small exits), standard 200 ms (menus, dialogs, content), slow 280 ms (sheets, drawers, larger context changes), easing `cubic-bezier(.2,0,0,1)`. Use the presets (`backdrop`, `dialog`, `popover`, `sheet-bottom|left|right`, `toast`, `disclosure`) or `motionDuration` / `motionEase`, and `duration-[var(--motion-*)] ease-standard` in classes (a bare `transition-*` utility already defaults to `--motion-fast` and the standard easing). No literal durations, delays or easings outside `packages/ui/src/motion`, `tokens.css` and `tokens.json`. Exits are no slower than entries.
4. **Smoothness.** Animate `opacity` and a full `transform` string: Motion runs exactly those through the Web Animations API on the compositor, so they stay smooth while React mounts the popup's content, and Base UI can detect them to time the unmount. The `x` / `y` / `scale` shorthands run on the main thread and are only for `layout` animations (toasts). The only layout properties that animate are a disclosure's height, a progress fill's width and the tabs indicator's width (absolutely positioned, so nothing else reflows).
5. **Reduced motion.** `useMotionPreset` switches to an opacity fade of at most 50 ms with no translate or scale, and the CSS tokens drop to 0 ms (design system: "Reduced 0 ms; optional brief fade up to 50 ms").
6. **Prove it.** Each animated component has unit tests for its open and close lifecycle (the exit keeps it mounted, then it unmounts) and an entry in the Playwright motion suite (`pnpm e2e:motion`, `e2e/motion/`, against Storybook), which records every frame in Chromium and asserts token durations and easing, compositor-only properties, in-between frames on entry and exit, no flicker, and the reduced-motion fade. The motion contract check (`pnpm check`, `packages/ui/src/motion/motion-contract.test.ts`) parses `packages/ui/src` and the web apps and fails on an un-animated Base UI popup, portal, toast or collapsible panel, or on literal timing in classes, inline styles or CSS.
7. **Native.** Motion does not support React Native. When `packages/ui-native` gains a popout, animate it with React Native's `Animated` or Reanimated on `nativeMotion` from `@nestself/tokens/native` and honour the system Reduce Motion setting.

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
- **Motion tests**: real-browser animation checks in `e2e/motion/`, run by Playwright against Storybook (`pnpm e2e:motion`).
- **Check scripts** (token smoke, locale parity, motion contract): run by `pnpm check`.

## How to add a component

1. Create the component file in `packages/ui/src/components/` (web) or `packages/ui-native/src/components/` (native).
2. Export it from the package's `src/index.ts`.
3. Use only semantic token references for colours -- no hex literals.
4. If any part of it pops out, slides or expands, animate it per the Motion rule and add it to `e2e/motion/`.
5. Write a colocated test (`*.test.tsx`) covering keyboard interaction, error states and any accessibility contract.
6. For web components, add a Storybook story in the same directory.
7. Run `pnpm --filter <package> lint && pnpm --filter <package> typecheck && pnpm --filter <package> test` before committing.

## How to add a route

1. Create the route file under the app's route directory (file-based routing for TanStack Router in workspace and admin, `app/` directory for Next.js marketing, `app/(tabs)/` for Expo Router mobile).
2. Use the app's existing layout and provider wrappers.
3. For workspace and admin, `beforeLoad` checks the role from router context if the route is role-gated.
4. Use sample data from `@nestself/sample-data` when the app is in sample mode; do not inline fictional data in the route module.
5. Add translations to the appropriate namespace in `packages/i18n/locales/`.

## Serbian Cyrillic catalogs

Cyrillic catalogs are generated from the Latin source by transliteration (`pnpm --filter @nestself/i18n build:cyrillic`) and checked by `pnpm check`. Do not edit `sr-Cyrl` JSON files by hand. The Latin catalogs are drafts pending a native speaker review.

Design constraints in `docs/design-handoff/CLAUDE.md` still apply.
