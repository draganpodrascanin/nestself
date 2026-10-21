# NestSelf marketing site implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the complete, production-looking NestSelf marketing site (English, Serbian Latin and Cyrillic, Hungarian) with generated imagery, working lead capture, resources (webinars, articles, self-assessments, tools) and Docker for Postgres, Redis and the API.

**Architecture:** Next.js 16 App Router app in `apps/marketing` on the shared `@nestself/ui` design system. UI strings in i18next catalogs; page copy in typed JSON content files; articles, webinars and tools in MDX; assessments as JSON data. Leads go through Next route handlers to a NestJS `LeadsModule` backed by Prisma. Design: `docs/superpowers/specs/2026-10-21-marketing-site-design.md`. Market language and imagery brief: `docs/research/2026-10-21-market-language-guide.md`.

**Tech stack:** Next 16.4 (webpack), React 19.3, Tailwind 4.3, Base UI 1.9, i18next 26, next-mdx-remote 6, gray-matter, remark-gfm, rehype-slug, zod 4, NestJS 12, Prisma 7.10, Vitest 5, Playwright 1.64, OpenAI GPT Image 2.5 via the `openai-image-gen` skill.

---

## Execution rules (every worker reads these before its task)

1. Repo `/Users/draganpodrascanin/Desktop/projects/Nestself`, branch `main`; the orchestrator commits at barriers. Node 24, pnpm 10.10.0, Turborepo. Workspace packages are source-only (JIT); versions are pinned in the `catalog:` of `pnpm-workspace.yaml`.
2. Never run `pnpm install`, `pnpm add`, `pnpm dlx`, `npx`, `nest new`, `create-*`, `storybook init`, `git commit`, `git checkout`, `git stash` or anything that touches `pnpm-lock.yaml` or `node_modules`. If a dependency is missing, finish everything else and report it under missingDependencies.
3. Colour rule: semantic tokens only (`bg-primary`, `text-text-secondary`, `border-border-subtle`, `var(--color-focus)`). No hex literal outside `packages/tokens`; `pnpm check` scans `packages/ui/src`, `packages/ui-native/src` and `apps/*/src`.
4. Content rule for this site: no invented statistics, outcome claims, client logos, availability ("24/7") or response-time promises; family coverage is always "where included in your employer's plan"; self-assessments are never diagnoses and always show the disclaimer and crisis block; expert portraits are roles and initials, never generated faces with names; testimonials come only from `SAMPLE_TESTIMONIALS` in `@nestself/sample-data` (placeholder-flagged); pricing shows no numbers.
5. Where text lives: UI strings (nav, buttons, labels, errors, shared microcopy) in `packages/i18n/locales/<locale>/marketing.json` or `common.json`; page copy in `apps/marketing/content/pages/<page>/<locale>.json`; articles, webinars, tools in `apps/marketing/content/<type>/<slug>/<locale>.mdx`; assessments in `apps/marketing/content/assessments/<slug>/<locale>.json`. Whoever adds a catalog key adds it to `en`, `sr-Latn` and `hu` (draft translations are fine) and regenerates Cyrillic with `pnpm --filter @nestself/i18n build:cyrillic`. Phase B content files are written in `en` only; Phase C translates them. Until then run `CONTENT_ALLOW_MISSING_LOCALES=1 pnpm --filter @nestself/marketing check`.
6. Next.js 16 differs from older versions: for anything you are unsure about (App Router conventions, `generateMetadata`, route handlers, `proxy.ts`, caching) read the matching guide under `apps/marketing/node_modules/next/dist/docs/01-app/` first. `typedRoutes` is on. Server components by default; add `'use client'` only for interactivity. Internal links may use plain anchors (`LinkButton`, `TextLink` from `@nestself/ui`) or `next/link`.
7. Components come from `@nestself/ui` (Base UI + Tailwind v4, no `dark:` variant; palettes and modes switch via CSS variables). Type roles: `Heading` (`display`, `editorial`, `screenTitle`, `sectionTitle`, `marketingHero`), `Text` (`bodyLarge`, `body`, `label`, `metadata`), `Eyebrow`. Container queries: `@max-[760px]:`, `@min-[1024px]:` (the page `<main>` is a `@container`). Radii: `rounded-card`, `rounded-control`. Photos only through `PhotoFigure` with keys from `@nestself/assets`. Icons: Phosphor (`@phosphor-icons/react`), Regular for controls, Duotone for support categories, always `aria-hidden` with a text label next to them.
8. Accessibility: full keyboard operation; visible focus (`focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus`); labelled landmarks; `aria-current="page"`; errors associated through `Field` and `FormErrorSummary`; reduced motion respected; no horizontal scroll at 320 px; targets at least 44 px. Every page renders exactly one `<main id="main" tabIndex={-1}>` and one `<h1>`.
9. Screenshots are mandatory for page tasks: with the marketing dev server running (`pnpm --filter @nestself/marketing dev`, port 3000; reuse it if it is already up; never kill a server you did not start) run `node e2e/snap.mjs http://localhost:3000/en/<path> --name <page> --out e2e/snaps/<task-key>` and open both PNGs (390 and 1440) with the Read tool. Fix what looks wrong before reporting, and list the PNG paths.
10. Tests: Vitest, colocated `*.test.ts` / `*.test.tsx`. In `apps/marketing`, `.test.tsx` runs in jsdom and `.test.ts` in node (`apps/marketing/vitest.config.ts`); the axe helper is `apps/marketing/src/test/axe.ts` (`expectNoA11yViolations`). In `packages/ui` follow the existing component pattern: test file, story file, index export.
11. Verification per package: `pnpm --filter <pkg> lint`, `pnpm --filter <pkg> typecheck`, `pnpm --filter <pkg> test`; plus whatever the task lists. Report real output.
12. Database for API work: Postgres 17 is running locally; use `DATABASE_URL=postgresql://nestself:nestself_dev@localhost:54329/nestself` (migrations applied up to `init`).
13. Report honestly: a requirement you did not do goes under `unimplemented` with the reason; never claim a screenshot you did not look at.

---

## Phase A: foundations (parallel, disjoint directories)

### Task A1: Hungarian locale

**Owns:** `packages/i18n/**`, `e2e/pages.ts`, `e2e/helpers.ts`, `e2e/snap.mjs`, `e2e/README.md`, `apps/marketing/README.md`. Does not touch `packages/contracts` (Task A4 adds `hu` to `LocaleSchema`).

**Files:**
- Modify: `packages/i18n/src/types.ts`, `packages/i18n/src/config.ts`, `packages/i18n/src/resources.ts`, `packages/i18n/src/negotiate.test.ts`, `packages/i18n/src/format.test.ts`, `packages/i18n/scripts/check-locales.mjs`
- Create: `packages/i18n/locales/hu/marketing.json` (the other four `hu` catalogs already exist and are correct; do not rewrite them)
- Modify: `e2e/pages.ts`, `e2e/helpers.ts`, `e2e/snap.mjs`, `e2e/README.md`, `apps/marketing/README.md`

- [ ] **Step 1: Write the failing tests**

In `packages/i18n/src/negotiate.test.ts` add:

```ts
it('negotiates Hungarian from hu-HU and bare hu', () => {
  expect(negotiateLocale(['hu-HU'])).toBe('hu');
  expect(negotiateLocale(['hu'])).toBe('hu');
  expect(negotiateLocale(['de', 'hu;q=0.8'].map((t) => t.split(';')[0]!))).toBe('hu');
});
it('isLocale accepts hu', () => {
  expect(isLocale('hu')).toBe(true);
});
```

In `packages/i18n/src/format.test.ts` add a Hungarian date case using the existing helper signature (read the file first), expecting the `hu-HU` Intl output for 21 October 2026 (`2026. október 21.`).

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm --filter @nestself/i18n test`
Expected: the new tests fail (`hu` is not a supported locale).

- [ ] **Step 3: Add the locale**

`packages/i18n/src/types.ts`: `locales = ['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const`; `localeMeta.hu = { htmlLang: 'hu', hreflang: 'hu', intl: 'hu-HU', nativeName: 'Magyar', script: 'Latn', dir: 'ltr' }`.
`packages/i18n/src/config.ts`: `fallbackLng` gains `hu: ['en']`.
`packages/i18n/src/resources.ts`: import the five `hu` catalogs and add the `hu` block.

- [ ] **Step 4: Translate the marketing catalog**

Create `packages/i18n/locales/hu/marketing.json` from `en/marketing.json`: identical keys and order, every `{{placeholder}}` kept, no empty strings, Hungarian plurals only `_one`/`_other`. Register: natural modern Hungarian B2B marketing copy, sentence case, correct diacritics. Terminology: wellbeing = jóllét; mental health = mentális egészség; psychological support = pszichológiai támogatás; psychotherapy = pszichoterápia; counselling/consultation = tanácsadás; legal consultation = jogi tanácsadás; financial consultation = pénzügyi tanácsadás; employee = munkavállaló; employer = munkáltató; for employers = munkáltatóknak; for employees = munkavállalóknak; HR = HR; manager = vezető; team = csapat; confidential = bizalmas; privacy = adatvédelem; webinar = webinárium; article = cikk; self-assessment = önértékelés; request a demo = demó kérése; get started = kezdjük el; contact = kapcsolat; about us = rólunk. The brand stays "NestSelf"/"nestself".

- [ ] **Step 5: Teach the parity checker about Hungarian**

In `packages/i18n/scripts/check-locales.mjs`: `localeNames = ['en', 'sr-Latn', 'sr-Cyrl', 'hu']`; replace the Serbian-only plural check with a map `{ 'sr-Latn': ['_one', '_few', '_other'], 'sr-Cyrl': ['_one', '_few', '_other'], hu: ['_one', '_other'] }` applied per locale; the success line becomes `All N namespaces consistent across 4 locales.` Keep the Cyrillic transliteration check unchanged (it only concerns `sr-Latn` to `sr-Cyrl`).

- [ ] **Step 6: Update e2e types and docs**

`e2e/pages.ts`: `locale?: 'en' | 'sr-Latn' | 'sr-Cyrl' | 'hu'`. `e2e/helpers.ts`: same union in `applyLocale`. `e2e/snap.mjs`: accept `hu` in the `--locale` validation and usage text. `e2e/README.md` option table and `apps/marketing/README.md` supported-locales sentence mention `hu`.

- [ ] **Step 7: Verify**

Run: `pnpm --filter @nestself/i18n lint && pnpm --filter @nestself/i18n typecheck && pnpm --filter @nestself/i18n test && pnpm --filter @nestself/i18n check`
Expected: tests pass; check prints `All 5 namespaces consistent across 4 locales.`
Run: `pnpm typecheck` (whole repo) and `pnpm lint:root`.
Expected: all green. If workspace, admin or mobile language switchers enumerate `locales`, they now list Magyar automatically; if any of them hard-codes the three locales, report it under concerns (do not edit those apps).

### Task A2: Content layer (MDX, page content, assessments, transliteration and parity)

**Owns:** `apps/marketing/src/content/**`, `apps/marketing/content/**`, `apps/marketing/scripts/**`, `apps/marketing/package.json` (scripts only), `apps/marketing/src/components/content/**`.

**Files:**
- Create: `apps/marketing/src/content/types.ts`, `apps/marketing/src/content/schemas.ts`, `apps/marketing/src/content/loaders.ts`, `apps/marketing/src/content/loaders.test.ts`, `apps/marketing/src/content/mdx.tsx`, `apps/marketing/src/content/reading-time.ts`, `apps/marketing/src/content/reading-time.test.ts`, `apps/marketing/src/content/__fixtures__/**` (sample content tree used by tests), `apps/marketing/src/components/content/Callout.tsx`, `apps/marketing/src/components/content/Figure.tsx`, `apps/marketing/content/README.md`, `apps/marketing/scripts/transliterate-content.mjs`, `apps/marketing/scripts/transliterate-content.test.mjs`, `apps/marketing/scripts/check-content.mjs`
- Modify: `apps/marketing/package.json` scripts: `"check": "node scripts/check-content.mjs"`, `"content:cyrillic": "node scripts/transliterate-content.mjs --write"`

Directory layout under `apps/marketing/content/`: `articles/<slug>/<locale>.mdx`, `webinars/<slug>/<locale>.mdx`, `tools/<slug>/<locale>.mdx`, `assessments/<slug>/<locale>.json`, `pages/<page>/<locale>.json`. Locales: `en`, `sr-Latn`, `sr-Cyrl` (generated), `hu`.

- [ ] **Step 1: Types and schemas**

`types.ts`:

```ts
import type { Locale } from '@nestself/i18n';
export type ContentType = 'articles' | 'webinars' | 'tools';
export interface ContentEntry<F> {
  type: ContentType;
  slug: string;
  /** Locale actually served. */
  locale: Locale;
  requestedLocale: Locale;
  fallback: boolean;
  frontmatter: F;
  body: string;
  readingMinutes: number;
}
export interface LocalisedData<T> { data: T; locale: Locale; fallback: boolean }
```

`schemas.ts` (zod 4):

```ts
export const TopicSchema = z.enum(['psychological', 'legal', 'financial', 'work', 'family', 'managers']);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const IsoDateTime = z.string().datetime({ offset: true });
export const ArticleFrontmatterSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(200),
  topic: TopicSchema,
  publishedAt: IsoDate,
  updatedAt: IsoDate.optional(),
  cover: z.string().min(1),
  coverAlt: z.string().min(1),
  author: z.string().default('NestSelf editorial team'),
  related: z.array(z.string()).default([]),
  draft: z.boolean().default(false),
});
export const WebinarFrontmatterSchema = z.object({
  title: ..., description: ..., topic: TopicSchema,
  startsAt: IsoDateTime, durationMinutes: z.number().int().positive(),
  format: z.enum(['live', 'on-demand']),
  speaker: z.object({ role: z.string().min(1), area: TopicSchema }),
  languages: z.array(z.enum(['en', 'sr', 'hu'])).min(1),
  cover: ..., coverAlt: ..., registrationOpen: z.boolean().default(true),
  recordingAvailable: z.boolean().default(false), draft: z.boolean().default(false),
});
export const ToolFrontmatterSchema = z.object({
  title, description, topic: TopicSchema, kind: z.enum(['guide', 'planner', 'checklist']),
  cover, coverAlt, order: z.number().int().default(100), draft: z.boolean().default(false),
});
export const AssessmentSchema = z.object({
  title: z.string().min(1), intro: z.string().min(1), durationMinutes: z.number().int().positive(), topic: TopicSchema,
  instrument: z.object({ name: z.string(), source: z.string().url(), licence: z.string() }),
  questions: z.array(z.object({ id: z.string(), text: z.string() })).min(1),
  options: z.array(z.object({ label: z.string(), score: z.number() })).min(2),
  scoring: z.object({ min: z.number(), max: z.number(), bands: z.array(z.object({ min: z.number(), max: z.number(), title: z.string(), body: z.string(), nextStep: z.string() })).min(1) }),
  disclaimer: z.string().min(1),
  crisis: z.object({ title: z.string(), body: z.string(), lines: z.array(z.object({ label: z.string(), value: z.string() })) }),
});
export type ArticleFrontmatter = z.infer<...>; // and the others
export type FrontmatterOf<T extends ContentType> = T extends 'articles' ? ArticleFrontmatter : T extends 'webinars' ? WebinarFrontmatter : ToolFrontmatter;
export const frontmatterSchemas = { articles: ArticleFrontmatterSchema, webinars: WebinarFrontmatterSchema, tools: ToolFrontmatterSchema } as const;
```

- [ ] **Step 2: Failing loader tests**

Create fixtures under `src/content/__fixtures__/` mirroring the real layout with: `articles/example/en.mdx` and `sr-Latn.mdx` (no `hu`), one draft article, `webinars/example/en.mdx`, `assessments/example/en.json`, `pages/home/en.json` and `hu.json`. Tests in `loaders.test.ts` (pass `{ root: fixturesDir }`):

- `getEntry('articles','example','sr-Latn')` returns the Serbian file with `fallback: false`.
- `getEntry('articles','example','hu')` returns the English body with `locale: 'en'`, `requestedLocale: 'hu'`, `fallback: true`.
- `getEntry('articles','missing','en')` returns `null`.
- `listEntries('articles','en')` excludes drafts (unless `{ includeDrafts: true }`) and sorts by `publishedAt` descending; `listEntries('webinars', 'en')` sorts by `startsAt` ascending.
- `listSlugs('articles')` lists directories that contain at least an `en` file.
- Frontmatter validation failure throws an error whose message contains the file path and the zod issue path.
- `getAssessment('example','en').data.questions.length` matches; `loadPageContent('home','hu', schema)` returns the Hungarian file; a missing locale falls back to `en` with `fallback: true`; when `process.env.CONTENT_STRICT === '1'` a fallback throws instead.
- `readingMinutes` is `Math.max(1, Math.round(words / 200))`.

Run: `pnpm --filter @nestself/marketing test`
Expected: FAIL (modules missing).

- [ ] **Step 3: Implement loaders**

`loaders.ts` with signatures:

```ts
export interface LoaderOptions { root?: string; includeDrafts?: boolean }
export async function listSlugs(type: ContentType, opts?: LoaderOptions): Promise<string[]>
export async function listEntries<T extends ContentType>(type: T, locale: Locale, opts?: LoaderOptions): Promise<ContentEntry<FrontmatterOf<T>>[]>
export async function getEntry<T extends ContentType>(type: T, slug: string, locale: Locale, opts?: LoaderOptions): Promise<ContentEntry<FrontmatterOf<T>> | null>
export async function listAssessmentSlugs(opts?: LoaderOptions): Promise<string[]>
export async function getAssessment(slug: string, locale: Locale, opts?: LoaderOptions): Promise<(LocalisedData<Assessment> & { slug: string }) | null>
export async function listAssessments(locale: Locale, opts?: LoaderOptions): Promise<Array<LocalisedData<Assessment> & { slug: string }>>
export async function loadPageContent<S extends z.ZodTypeAny>(page: string, locale: Locale, schema: S, opts?: LoaderOptions): Promise<LocalisedData<z.infer<S>>>
export const CONTENT_ROOT: string // path.join(process.cwd(), 'content')
```

Rules: read with `node:fs/promises`; parse MDX frontmatter with `gray-matter`; validate with the schema and rethrow as `new Error(\`Invalid content: ${file}: ${issues}\`)`; locale resolution order is `[locale, 'en']` except `sr-Cyrl` which tries `['sr-Cyrl', 'sr-Latn', 'en']`; in strict mode (`CONTENT_STRICT=1`) any fallback throws; wrap the public functions with React `cache()` for per-request memoisation (import from `react`; keep a plain uncached variant for tests if simpler).

- [ ] **Step 4: MDX rendering**

`mdx.tsx`: `export async function renderMdx(source: string): Promise<ReactNode>` using `compileMDX` from `next-mdx-remote/rsc` with `mdxOptions: { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] }` and components: `h2`/`h3` rendered through `Heading` with their ids preserved, `p` through `Text`, `a` as `TextLink` (external links get `rel="noopener noreferrer"` and `target="_blank"`), `ul`/`ol` with design-system spacing, `blockquote` as a quiet aside, plus `Callout` (`kind: 'note' | 'tip' | 'warning'`, uses `Alert` from `@nestself/ui` if its API fits, otherwise a bordered box with an icon and an `aria-label`) and `Figure` (`photo`, `alt`, `caption?` rendered via `PhotoFigure`). Add a test in `mdx.test.tsx` that renders a small MDX string with a Callout and a heading and asserts the heading id and the callout text.

- [ ] **Step 5: Transliteration and parity scripts**

`scripts/transliterate-content.mjs` (`--write` | `--check`): for every `sr-Latn` file under `content/**`, produce the `sr-Cyrl` sibling. Reuse `transliterate` and `transliterateObject` from `../../packages/i18n/scripts/transliterate-core.mjs` (relative import from the script's own directory). For `.mdx`: split frontmatter (gray-matter), transliterate only string values of these keys: `title`, `description`, `coverAlt`, `author`, `speaker.role`; keep all other keys verbatim; transliterate the body while protecting fenced code blocks, inline code, link and image destinations in `](...)`, autolinks, HTML/JSX tags and their attributes, and import/export lines. For `.json`: `transliterateObject` with an `untouchedKeys` set `['cover', 'slug', 'id', 'href', 'url', 'source', 'icon', 'key', 'locale', 'topic', 'format', 'kind', 'languages']` and any string that matches `^https?://`. Tests in `transliterate-content.test.mjs` cover: a code span and a URL survive untouched; `title` is transliterated; `cover` is not; `--check` detects a stale Cyrillic file.

`scripts/check-content.mjs`: walks `content/`; for every slug (or page) verifies: `en` exists; `sr-Latn` and `hu` exist (error, or a warning when `CONTENT_ALLOW_MISSING_LOCALES=1`); `sr-Cyrl` equals a fresh transliteration of `sr-Latn`; every file validates against its schema (import the schemas by loading `src/content/schemas.ts` through `node --experimental-strip-types`-free means: duplicate the minimal validation by spawning `vitest`? No: compile-free path is to have the script import the schema module directly, which works because Node 24 strips types; write it as `await import('../src/content/schemas.ts')`); every `cover` key exists in `@nestself/assets` `photos.json`; every `related` slug exists. Prints a one-line summary `Content check: N articles, N webinars, N tools, N assessments, N pages across 4 locales.` and exits 1 on errors.

- [ ] **Step 6: Content README**

`content/README.md`: layout, frontmatter fields per type (copy the schema), how to add an article in the three source locales, how to regenerate Cyrillic (`pnpm --filter @nestself/marketing content:cyrillic`), what `check` validates, and the content rules (execution rule 4).

- [ ] **Step 7: Verify**

Run: `pnpm --filter @nestself/marketing lint && pnpm --filter @nestself/marketing typecheck && pnpm --filter @nestself/marketing test && pnpm --filter @nestself/marketing check`
Expected: tests pass; check reports zero content (no real content yet) and exits 0.

### Task A3: UI additions (Accordion, Card, ProgressBar, Breadcrumbs)

**Owns:** `packages/ui/**` (only the four new component directories plus the group `index.ts` files).

**Files:**
- Create: `packages/ui/src/components/navigation/accordion/{Accordion.tsx,Accordion.test.tsx,Accordion.stories.tsx,index.ts}`
- Create: `packages/ui/src/components/navigation/breadcrumbs/{Breadcrumbs.tsx,Breadcrumbs.test.tsx,Breadcrumbs.stories.tsx,index.ts}`
- Create: `packages/ui/src/components/feedback/progress-bar/{ProgressBar.tsx,ProgressBar.test.tsx,ProgressBar.stories.tsx,index.ts}`
- Create: `packages/ui/src/components/patterns/card/{Card.tsx,Card.test.tsx,Card.stories.tsx,index.ts}`
- Modify: `packages/ui/src/components/navigation/index.ts`, `packages/ui/src/components/feedback/index.ts`, `packages/ui/src/components/patterns/index.ts`

Read an existing component of each group first (for example `navigation/tabs`, `feedback/alert`, `patterns/coverage-notice`) and mirror its file shape, test style (Testing Library + `expectNoA11yViolations` from `src/test/axe.ts`) and story style.

- [ ] **Step 1: Accordion (Base UI `@base-ui/react/accordion`)**

API: `<Accordion multiple? defaultValue?: string[] value? onValueChange? className?>` wrapping `<AccordionItem value title children className?>`. Each item renders `Accordion.Item`, `Accordion.Header` as an `h3` by default (prop `headingLevel?: 2 | 3 | 4`), `Accordion.Trigger` (full-width button, `type-body`, Phosphor `CaretDown` that rotates with `data-panel-open`, 44 px min height, focus ring) and `Accordion.Panel` (`Text` body spacing, `data-open` transitions, respects reduced motion). Tests: click toggles `aria-expanded` and reveals the panel; Enter and Space toggle; `aria-controls` links trigger to panel; single mode closes the other item; `multiple` keeps both open; axe passes. Story: FAQ with four items.

- [ ] **Step 2: Breadcrumbs**

API: `<Breadcrumbs label items={[{ label, href? }]} className?>` rendering `<nav aria-label={label}><ol>` with links for items that have `href`, the last item as plain text with `aria-current="page"`, Phosphor `CaretRight` separators `aria-hidden`, wrapping on narrow widths. Tests: structure, `aria-current`, links, axe. Story.

- [ ] **Step 3: ProgressBar (Base UI `@base-ui/react/progress`)**

API: `<ProgressBar value label showValue? className?>` with `value` 0 to 100, visible label (`type-label`) and optional `n%` value text, track `bg-border-subtle` (or the closest existing surface token), indicator `bg-primary`, `role="progressbar"` with `aria-valuenow/min/max` and an accessible name from the label. Tests: attributes, value text, axe. Story.

- [ ] **Step 4: Card**

API: `<Card as?: 'div' | 'article' | 'section' | 'li' padding?: 'none' | 'sm' | 'md' | 'lg' tone?: 'surface' | 'subtle' | 'brand' interactive?: boolean className?>` rendering `rounded-card border border-border-subtle` with the tone background from the semantic tokens (look up available surface tokens in `packages/tokens/tailwind.css` and `tokens.css`, do not invent names), `interactive` adds hover border/shadow and a `focus-within` ring so a card containing a single link reads as clickable while the link stays the only focusable element. Tests: element type, padding and tone classes, axe. Story with all tones.

- [ ] **Step 5: Export and verify**

Add exports to the three group `index.ts` files (named exports and types).
Run: `pnpm --filter @nestself/ui lint && pnpm --filter @nestself/ui typecheck && pnpm --filter @nestself/ui test && pnpm --filter @nestself/ui storybook:build`
Expected: all pass; the smoke test (`pnpm --filter @nestself/tokens check`) still finds no hex.

### Task A4: Leads contracts, API module, migration, runtime TypeScript imports

**Owns:** `packages/contracts/**`, `packages/typescript-config/**`, `apps/api/**` (except `apps/api/Dockerfile`), `.env.example`.

**Why the import change:** the API will import zod schemas from `@nestself/contracts` at runtime. The package is source-only and Node 24 runs TypeScript directly by type stripping, but only when relative imports use `.ts` suffixes (verified: `.js` suffixes fail with `ERR_MODULE_NOT_FOUND`). TypeScript 5.9 allows `.ts` relative imports under NodeNext with `rewriteRelativeImportExtensions`.

**Files:**
- Modify: `packages/typescript-config/base.json` (`"allowImportingTsExtensions": true`), `packages/typescript-config/nestjs.json` (`"allowImportingTsExtensions": false`, `"rewriteRelativeImportExtensions": true`)
- Modify: every relative import in `packages/contracts/src/*.ts` from `./x.js` to `./x.ts`
- Modify: `packages/contracts/src/locale.ts` (`'hu'` added), `packages/contracts/src/contracts.test.ts` (hu assertion)
- Create: `packages/contracts/src/leads.ts`, `packages/contracts/src/leads.test.ts`; Modify: `packages/contracts/src/index.ts`
- Modify: `apps/api/prisma/schema.prisma`; Create: `apps/api/prisma/migrations/<timestamp>_leads/migration.sql` (via Prisma)
- Create: `apps/api/src/common/zod-validation.pipe.ts`, `apps/api/src/leads/leads.module.ts`, `apps/api/src/leads/leads.controller.ts`, `apps/api/src/leads/leads.service.ts`, `apps/api/src/leads/leads.controller.spec.ts`
- Modify: `apps/api/src/app.module.ts`, `apps/api/src/config/env.ts` (`REDIS_URL: z.string().url().optional()`), `.env.example` (add `REDIS_URL=redis://localhost:6379` under the api block with a comment "reserved for BullMQ queues")

- [ ] **Step 1: TypeScript presets and contracts imports**

Apply the preset changes, rename the suffixes (`sed` across `packages/contracts/src`), add `'hu'` to `locales` in `locale.ts` and a test `expect(LocaleSchema.parse('hu')).toBe('hu')`.
Run: `pnpm --filter @nestself/contracts test && pnpm typecheck`
Expected: every package typechecks (Bundler-resolution packages accept `.ts` imports through `allowImportingTsExtensions`; the API accepts them through `rewriteRelativeImportExtensions`). If tsc rejects the combination, report the exact diagnostic under concerns and try `"allowImportingTsExtensions": true` only in `base.json` with `"rewriteRelativeImportExtensions": true` only in `nestjs.json`.
Run from `apps/api`: `node -e "import('@nestself/contracts').then((m) => console.log(Object.keys(m).length))"`
Expected: a number, no error, no warning.

- [ ] **Step 2: Lead schemas (failing tests first)**

`leads.test.ts`: a valid demo request parses and lower-cases the email; `consent: false` fails; a filled honeypot (`website: 'x'`) fails; unknown `kind` fails; `webinarSlug` with spaces fails.

`leads.ts`:

```ts
import { z } from 'zod';
import { LocaleSchema } from './locale.ts';
export const CompanySizeSchema = z.enum(['1-49', '50-199', '200-499', '500-999', '1000+']);
export const CountrySchema = z.enum(['RS', 'HU', 'OTHER']);
const Email = z.string().trim().toLowerCase().email().max(254);
const Text = (max: number) => z.string().trim().min(1).max(max);
const LeadBase = z.object({
  locale: LocaleSchema,
  consent: z.literal(true),
  /** Honeypot: humans never see it, so it must be empty. */
  website: z.string().max(0).optional(),
  source: z.string().max(100).optional(),
});
export const DemoRequestSchema = LeadBase.extend({ kind: z.literal('demo_request'), name: Text(120), email: Email, company: Text(160), companySize: CompanySizeSchema, country: CountrySchema, role: Text(120).optional(), message: z.string().trim().max(2000).optional() });
export const ContactMessageSchema = LeadBase.extend({ kind: z.literal('contact'), name: Text(120), email: Email, subject: Text(160), message: Text(4000) });
export const WebinarRegistrationSchema = LeadBase.extend({ kind: z.literal('webinar_registration'), webinarSlug: z.string().regex(/^[a-z0-9-]+$/).max(120), name: Text(120), email: Email, company: z.string().trim().max(160).optional() });
export const LeadSchema = z.discriminatedUnion('kind', [DemoRequestSchema, ContactMessageSchema, WebinarRegistrationSchema]);
export const LeadAcceptedSchema = z.object({ id: z.string(), kind: z.enum(['demo_request', 'contact', 'webinar_registration']), receivedAt: z.string() });
export type DemoRequest = z.infer<typeof DemoRequestSchema>; // plus ContactMessage, WebinarRegistration, Lead, LeadAccepted
```

Export everything from `index.ts`.

- [ ] **Step 3: Prisma model and migration**

```prisma
enum LeadKind {
  DEMO_REQUEST
  CONTACT
  WEBINAR_REGISTRATION
}

model Lead {
  id        String   @id @default(cuid())
  kind      LeadKind
  email     String
  locale    String
  source    String?
  payload   Json
  createdAt DateTime @default(now()) @map("created_at")

  @@index([kind, createdAt])
  @@map("leads")
}
```

Run: `DATABASE_URL=postgresql://nestself:nestself_dev@localhost:54329/nestself pnpm --filter @nestself/api exec prisma migrate dev --name leads`
Expected: a new migration directory and `Your database is now in sync`. Then `pnpm --filter @nestself/api prisma:generate`.

- [ ] **Step 4: API module (tests first)**

`leads.controller.spec.ts` (supertest, pattern from `apps/api/test/health.e2e.spec.ts`): override `PrismaService` with a stub whose `lead.create` records its argument and returns `{ id: 'lead_1', createdAt: new Date('2026-10-21T10:00:00Z') }`. Cases: valid demo request returns 202 with `{ id, kind: 'demo_request', receivedAt }` and `lead.create` was called with `kind: 'DEMO_REQUEST'`, `email`, `locale`, `payload` containing `company`; invalid body returns 400 with `issues[]`; filled honeypot returns 202 and `lead.create` was not called; contact and webinar routes work; routes are public (no Authorization header).

`zod-validation.pipe.ts`: `@Injectable() class ZodValidationPipe implements PipeTransform { constructor(private readonly schema: ZodType) {} transform(value) { const r = this.schema.safeParse(value); if (!r.success) throw new BadRequestException({ message: 'Validation failed', issues: r.error.issues.map(({ path, message, code }) => ({ path, message, code })) }); return r.data; } }`.

`leads.controller.ts`: `@Controller('leads')`, each route `@Public()`, `@Throttle({ default: { limit: 5, ttl: 60_000 } })`, `@HttpCode(202)`, `@Post('demo-requests')` with `@Body(new ZodValidationPipe(DemoRequestSchema))`, same for `contact` and `webinar-registrations`.

`leads.service.ts`: `accept(lead: Lead): Promise<LeadAccepted>`: if `lead.website` is a non-empty string return a fake-looking but valid accepted object without storing (spam); otherwise strip `consent`, `website`, `kind`, `email`, `locale`, `source` into columns and the rest into `payload`, call `prisma.lead.create`, and return `{ id, kind, receivedAt }`. Leave the comment `// TODO(queue): enqueue a notification job here once BullMQ is wired (REDIS_URL).`

Register `LeadsModule` in `AppModule`.

- [ ] **Step 5: Runtime verification through the real build**

Run: `pnpm --filter @nestself/api lint && pnpm --filter @nestself/api typecheck && pnpm --filter @nestself/api test && pnpm --filter @nestself/api build`
Then start the built server on a spare port and probe it:

```bash
cd apps/api && PORT=4100 NODE_ENV=development DATABASE_URL=postgresql://nestself:nestself_dev@localhost:54329/nestself JWT_SECRET=test-secret-that-is-at-least-32-characters-long node dist/main.js > /tmp/nestself-api-4100.log 2>&1 &
sleep 4
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:4100/api/leads/demo-requests -H 'content-type: application/json' -d '{"kind":"demo_request","name":"Test Person","email":"Test@Example.com","company":"Example d.o.o.","companySize":"50-199","country":"RS","locale":"en","consent":true}'
curl -s -X POST localhost:4100/api/leads/demo-requests -H 'content-type: application/json' -d '{"kind":"demo_request"}' | head -c 300; echo
kill %1
```

Expected: `202`, then a 400 body with `issues`, and `psql`-visible row: `LC_ALL=C PGPASSWORD=nestself_dev /opt/homebrew/opt/postgresql@17/bin/psql -h localhost -p 54329 -U nestself -d nestself -Atc "select kind, email from leads"` prints `DEMO_REQUEST|test@example.com`. This proves the type-stripped contracts import works in the compiled server. Delete the test row afterwards.

### Task A5: Docker for Postgres, Redis and the API

**Owns:** `apps/api/Dockerfile`, `.dockerignore`, `docker/**`, root `package.json` scripts, `docs/environment.md` (add a section), `README.md` (one paragraph under running the API).

Docker Desktop is not running on this machine, so the image cannot be built here; write it to be correct by construction, validate what can be validated, and say so in the report.

- [ ] **Step 1: `.dockerignore` at the repo root**

```
**/node_modules
**/dist
**/.next
**/.turbo
**/storybook-static
**/coverage
**/e2e/test-results
**/e2e/playwright-report
**/e2e/snaps
apps/mobile/ios
apps/mobile/android
**/.expo
.git
*.log
.env
.env.*
!.env.example
NestSelf_Web_Handoff.zip
NestSelf_Design_System.html
docs/design-handoff/assets
```

- [ ] **Step 2: `apps/api/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1.7
# Multi-stage build for the NestSelf API. Build context is the repository root:
#   docker build -f apps/api/Dockerfile -t nestself-api .

FROM node:24-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
WORKDIR /repo

# Fetch every package in the lockfile into the store (cached across builds), then install only the API subtree offline.
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm install --frozen-lockfile --offline --filter "@nestself/api..."

FROM deps AS build
RUN pnpm --filter @nestself/api prisma:generate && pnpm --filter @nestself/api build
# Production node_modules for the API only (workspace packages are copied in as real directories).
RUN pnpm --filter @nestself/api --prod deploy --legacy /out

FROM node:24-alpine AS runtime
ENV NODE_ENV=production PORT=4000
RUN apk add --no-cache tini && addgroup -S nestself && adduser -S nestself -G nestself
WORKDIR /app
COPY --from=build --chown=nestself:nestself /out /app
COPY --from=build --chown=nestself:nestself /repo/apps/api/dist /app/dist
USER nestself
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:4000/api/health || exit 1
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
```

Notes to honour: `@nestself/contracts` ships TypeScript source and is executed by Node 24 type stripping (Task A4), so the runtime image needs no build of it; `pnpm deploy --legacy` is required on pnpm 10 unless `inject-workspace-packages` is set. Confirm both facts against `pnpm deploy --help` output and `node --help | grep -i strip`, and quote the lines in the report.

- [ ] **Step 3: Compose**

Replace `docker/docker-compose.yml`:

```yaml
name: nestself
services:
  postgres:
    image: postgres:17-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: nestself
      POSTGRES_PASSWORD: nestself_dev
      POSTGRES_DB: nestself
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U nestself -d nestself"]
      interval: 5s
      timeout: 5s
      retries: 10
  redis:
    image: redis:7-alpine
    restart: unless-stopped
    command: ["redis-server", "--save", "60", "1", "--loglevel", "warning"]
    ports: ["6379:6379"]
    volumes: [redisdata:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10
  migrate:
    profiles: [api]
    build: { context: .., dockerfile: apps/api/Dockerfile, target: build }
    command: ["pnpm", "--filter", "@nestself/api", "prisma:deploy"]
    environment:
      DATABASE_URL: postgresql://nestself:nestself_dev@postgres:5432/nestself
    depends_on:
      postgres: { condition: service_healthy }
  api:
    profiles: [api]
    build: { context: .., dockerfile: apps/api/Dockerfile }
    restart: unless-stopped
    env_file: [api.env]
    environment:
      DATABASE_URL: postgresql://nestself:nestself_dev@postgres:5432/nestself
      REDIS_URL: redis://redis:6379
    ports: ["4000:4000"]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
      migrate: { condition: service_completed_successfully }
volumes:
  pgdata:
  redisdata:
```

Create `docker/api.env.example` (JWT_SECRET placeholder of 32+ characters, MARKETING_URL, WORKSPACE_URL, ADMIN_URL, NODE_ENV=production, PORT=4000) and document copying it to `docker/api.env` (add `docker/api.env` to `.gitignore`; the `.env.*` rule may already cover it, check). Root `package.json` scripts: `db:up` = `docker compose -f docker/docker-compose.yml up -d postgres redis`, `db:down` = `docker compose -f docker/docker-compose.yml down`, `docker:api` = `docker compose -f docker/docker-compose.yml --profile api up --build`.

- [ ] **Step 4: Docs**

`docker/README.md`: what each service is, the two profiles, the migrate service, where Redis will be used (BullMQ queues for lead notifications and later jobs; nothing consumes it yet), how to run only the databases locally, how to build the API image in CI, and the statement that the image was not built on the authoring machine. `docs/environment.md`: a short "Docker" section pointing there. `README.md`: one paragraph.

- [ ] **Step 5: Validate what can be validated**

Run: `docker compose -f docker/docker-compose.yml config` (the CLI may fail without a daemon; if so, say so) and `node -e "require('yaml')"` is not available, so validate YAML by `python3 -c "import yaml,sys; yaml.safe_load(open('docker/docker-compose.yml'))"` if PyYAML exists, otherwise `pnpm exec prettier --check docker/docker-compose.yml`. Run `pnpm lint:root` and `pnpm exec prettier --check apps/api/Dockerfile docker/README.md`. Report exactly what ran.

---

## Phase B shared conventions (read before any page task)

These conventions are fixed so that page tasks can run in parallel without touching each other's files.

### B.0 Ownership map

| Area | Owner task | Files |
| --- | --- | --- |
| Chrome, layout, home, shared sections and cards | B1 | `apps/marketing/src/components/chrome/**`, `apps/marketing/src/components/sections/**`, `apps/marketing/src/components/cards/**`, `apps/marketing/src/app/[locale]/layout.tsx`, `apps/marketing/src/app/[locale]/page.tsx`, `apps/marketing/content/pages/home/**`, `packages/i18n/locales/*/marketing.json` (shared keys only), `packages/sample-data/src/fixtures/testimonials.ts`, `packages/sample-data/src/index.ts` |
| Employers, employees, managers, plans, about | B2 | `apps/marketing/src/app/[locale]/{for-employers,for-employees,for-managers,plans,about,faq}/**`, `apps/marketing/src/app/[locale]/employers/**` (redirect), `apps/marketing/content/pages/{for-employers,for-employees,for-managers,plans,about,faq}/**` |
| Services | B3 | `apps/marketing/src/app/[locale]/services/**`, `apps/marketing/src/app/[locale]/support/**` (redirect), `apps/marketing/content/pages/services*/**` |
| Webinars and articles | B4 | `apps/marketing/src/app/[locale]/{webinars,articles,resources}/**`, `apps/marketing/content/{articles,webinars}/**`, `apps/marketing/content/pages/{resources,webinars,articles}/**` |
| Tools and assessments | B5 | `apps/marketing/src/app/[locale]/tools/**`, `apps/marketing/src/components/assessment/**`, `apps/marketing/content/{tools,assessments}/**`, `apps/marketing/content/pages/tools/**` |
| Contact, legal, accessibility, credits, privacy model, route handlers, forms | B6 | `apps/marketing/src/app/[locale]/{demo,contact,legal,accessibility,credits,privacy-model}/**`, `apps/marketing/src/app/api/**`, `apps/marketing/src/components/forms/**`, `apps/marketing/src/lib/leads.ts`, `apps/marketing/content/pages/{demo,contact,legal-*,accessibility,privacy-model}/**` |

Every page task also owns `e2e/pages/marketing/<task-key>.ts` (its own registry fragment) and `e2e/snaps/<task-key>/` (its screenshots). Nobody edits `e2e/pages/marketing.ts` in Phase B; the orchestrator merges the fragments.

### B.1 Page content modules

Each page has a module `apps/marketing/src/app/[locale]/<page>/content.ts` exporting a zod `schema` and `export const loadContent = (locale: Locale) => loadPageContent('<page>', locale, schema)`; the JSON lives in `apps/marketing/content/pages/<page>/en.json` (Phase B writes English only). Page files are server components:

```tsx
export async function generateMetadata({ params }) { ... localizedMetadata({ locale, title: content.meta.title, description: content.meta.description, pathname: '/<page>' }) }
export default async function Page({ params }) {
  const { locale } = await params; if (!isLocale(locale)) notFound();
  const { data } = await loadContent(locale);
  return (<main id="main" tabIndex={-1} className="@container"> ...sections with props from data... </main>);
}
```

Every page content schema starts with `meta: { title, description }` and `hero`. Interactive pieces (forms, assessment runner, accordion wrappers) are small client components receiving already-translated strings as props.

### B.2 Shared section components (B1 builds them; everyone uses them)

All in `apps/marketing/src/components/sections/`, presentational, no copy inside, `className` passthrough, each with a `.test.tsx` (renders, landmarks, axe):

- `PageHero` { eyebrow?, title, lead, primaryCta: { label, href }, secondaryCta?, photo?: { key, alt }, variant: 'split' | 'stacked' | 'quiet' } renders the `h1`.
- `SplitSection` { id?, eyebrow?, title, paragraphs: string[], bullets?: string[], photo: { key, alt }, reverse?: boolean, cta? } image and text side by side, stacked under 760 px.
- `FeatureGrid` { id?, eyebrow?, title, lead?, columns: 2 | 3, items: { icon: IconName, title, body, href? }[] } where `IconName` is a whitelist mapped to Phosphor icons in `components/sections/icons.ts` (`heart`, `scales`, `wallet`, `users-three`, `chat-circle-text`, `calendar-check`, `lock-key`, `books`, `video-camera`, `chart-bar`, `shield-check`, `clock`, `buildings`, `sparkle`, `check-circle`, `globe`, `translate`, `hand-heart`).
- `StepsSection` { id?, eyebrow?, title, steps: { title, body }[] } numbered with `Eyebrow numbered`.
- `FaqSection` { id?, title, items: { question, answer }[] } uses `Accordion` and emits `FAQPage` JSON-LD through `JsonLd`.
- `TestimonialsSection` { title, lead?, items: Testimonial[] } renders quotes with initials avatars (`Avatar` from `@nestself/ui`), role and company descriptor, `data-placeholder="true"` on the section.
- `CtaBand` { title, body?, primary, secondary? } brand-toned band using `on-brand` button variant.
- `TrustStrip` { items: { icon: IconName, label }[] } facts only.
- `PlansSection` { tiers: { name, audience, includes: string[], cta: { label, href } }[], note } no prices.
- `ResourceTeasers` { title, articles: ArticleCardProps[], webinars: WebinarCardProps[], tools: ToolCardProps[], moreHref }.
- `ProseLayout` { children, aside? } reading width for MDX pages.
- `JsonLd` { data: object } renders a `script type="application/ld+json"` (in `components/seo/JsonLd.tsx`, owned by B1).

Cards in `apps/marketing/src/components/cards/`: `ArticleCard` { href, title, description, topicLabel, readingLabel, cover: { key, alt }, dateLabel }, `WebinarCard` { href, title, description, dateLabel, durationLabel, formatLabel, languagesLabel, cover }, `ToolCard` { href, title, description, kindLabel, cover }, `AssessmentCard` { href, title, intro, durationLabel, questionsLabel }. All use `Card interactive` with the title as the single link.

### B.3 Chrome

`SiteHeader` links (B1b): Services `/services`, For employers `/for-employers`, For employees `/for-employees`, Resources `/resources`, Plans `/plans`, About `/about`; actions slot: `LocaleSwitcher` and a `LinkButton` "Request a demo" to `/demo`. Footer (`SiteFooter`, B1): columns Product (services, for employers, for employees, for managers, plans), Resources (webinars, articles, tools, FAQ, privacy model), Company (about, demo, contact, accessibility, credits), Legal (privacy policy, terms, cookies, imprint); locale switcher; tagline. Shared catalog keys B1 adds (en, sr-Latn, hu, Cyrillic regenerated), which other tasks may use: `marketing:nav.*` for the links above, `marketing:actions.{requestDemo,openWorkspace,readMore,register,startAssessment,seeAll,contactUs,backTo}`, `marketing:labels.{readingTime,minutes,questions,live,onDemand,languages,topic,updated,published,placeholderTestimonial}`, `marketing:topics.{psychological,legal,financial,work,family,managers}`, `marketing:footer.*`, `marketing:locale.switcherLabel`.

### B.4 Testimonials fixture (B1)

`packages/sample-data/src/fixtures/testimonials.ts`:

```ts
export interface SampleTestimonial { id: string; placeholder: true; name: string; role: string; company: string; country: 'RS' | 'HU'; quote: Record<'en' | 'sr-Latn' | 'hu', string> }
export const SAMPLE_TESTIMONIALS: SampleTestimonial[] = [ /* six entries: HR director, people lead, CEO of a 120-person company, team lead, employee, works council member; companies as descriptors ("logistics company, Novi Sad, 240 employees"), first name and initial only */ ];
```

Quotes talk about launch experience, confidentiality and manager resources, never outcomes or statistics. `sr-Cyrl` is derived at render time with `transliterate` is not available in the browser, so B1 also stores `'sr-Cyrl'` generated once with the i18n transliteration core (run it in a script and paste the result; the key is `Record<Locale, string>`).

### B.5 e2e fragments and screenshots

Each page task creates `e2e/pages/marketing/<task-key>.ts`:

```ts
import type { PageEntry } from '../../pages';
export const pages: PageEntry[] = [
  { name: 'marketing-employers', url: 'http://localhost:3000/en/employers' },
  { name: 'marketing-employers-hu', url: 'http://localhost:3000/hu/employers', locale: 'hu' },
];
```

Register every route the task adds for `en`; add `hu` and `sr-Cyrl` variants for the task's main page; add a `prepare` action only when a state needs interaction (export it as `prepareActions` from the fragment). Take and look at screenshots with `node e2e/snap.mjs` per execution rule 9 for every route at both widths, in `en` and `hu`.


## Phase B: pages (parallel by page group, after Phase A and the image registration)

### B.6 Voice and language (applies to every page task)

Write English copy that an HR director in Novi Sad or Budapest and an employee on a phone both understand at first read. Warm, plain, concrete; second person; short sentences; no jargon ("care navigation", "holistic", "synergy"), no superlatives, no promises we cannot keep. Employees see "support", "talk to a psychologist", "book a session"; employers see "programme", "benefit", "launch", "insights". Confidentiality is stated precisely every time it comes up: "Your employer never learns who used NestSelf or what was discussed. HR sees anonymised usage for groups of 10 or more." Family coverage: "where your employer's plan includes family members". Crisis: every psychological page and every assessment carries the crisis block (Serbia: 112 emergency, 194 ambulance; Hungary: 112 emergency, 104 ambulance; "if you are in immediate danger, call the emergency number now"). If `docs/research/2026-10-21-market-language-guide.md` exists when you start, read its sections 1, 2 and 5 and prefer its phrasings and offering names; if it does not exist yet, use the names in the spec section 2. Topics are always one of `psychological`, `legal`, `financial`, `work`, `family`, `managers`. Adopted from the market guide (sections 2 and 3): offering names are "Therapy & Counselling" (SR "Psihoterapija i savetovanje", HU "Pszichoterápia és tanácsadás"), "Legal Consultation" ("Pravno savetovanje", "Jogi tanácsadás"), "Financial Guidance" ("Finansijsko savetovanje", "Pénzügyi tanácsadás"), "Webinars" ("Vebinari", "Webináriumok"), "Articles" inside a "Resources" hub ("Resursi", "Tudástár"), "Wellbeing check-ins" for self-assessments ("Provera blagostanja", "Közérzeti pulzus"), "Self-help tools" ("Alati za samopomoć", "Önsegítő eszközök"), "Workforce insights" ("Uvidi za HR", "HR betekintések"), "Manager support" ("Podrška za rukovodioce", "Vezetői támogatás"), "Family support" ("Podrška za porodicu", "Családi támogatás"). Routes: `/for-employers`, `/for-employees`, `/for-managers`, `/services`, `/services/therapy`, `/services/legal-consultation`, `/services/financial-guidance`, `/resources`, `/articles`, `/webinars`, `/tools`, `/plans`, `/about`, `/faq`, `/demo` (demo request form; every "Request a demo" CTA points here), `/contact`, `/privacy-model`, `/accessibility`, `/legal/*`, `/credits`. Do not adopt the guide's "24/7 crisis line", "certificates of attendance", "unlimited sessions", "all data held in the EU" or newsletter items: they are promises we cannot make yet. Published third-party benchmarks may be quoted with their source (WHO fact sheet on mental health at work: "for every US$1 invested in treatment for depression and anxiety there is a US$4 return"), never presented as NestSelf results. Hungarian marketing copy addresses the reader informally ("te"); Serbian uses formal "Vi". Describe professionals as "licensed psychologists and qualified psychotherapists" (Serbia has no psychotherapy licensing law yet; the guide's open question 5), and the programme, where a formal noun is needed, as an "employee wellbeing programme" (SR "program pomoći zaposlenima", HU "munkavállalói jólléti program"). The minimum group size for anonymised HR reporting is 10.

Photo keys available after the image registration (all 3:2 masters, generated for NestSelf; use `imageRole="hero-3x2"` for page heroes and `card`/`article` roles for cards): `home-hero-kitchen`, `home-hero-walk`, `home-hero-office`, `employers-hr-meeting`, `employees-break`, `psychological-video-call`, `psychological-inperson`, `legal-consultation`, `financial-planning`, `family-cooking`, `family-park-walk`, `manager-one-on-one`, `webinar-speaker`, `webinar-viewer`, `article-morning`, `article-end-of-day`, `article-budget`, `article-contract`, `article-parenting`, `tools-notebook`, `assessment-sofa`, `about-studio`, `remote-home-dog`, `og-wide`, plus the original Pexels set (`family-grass`, `family-autumn`, `grandfather`, `older-couple`, `family-carry`, `family-play`, `care-home`, `couple-cooking`, `friends-men`, `friends-bench`). Run `pnpm --filter @nestself/marketing images:sync` once before taking screenshots so `public/images` has the new variants.

### Task B1a: Shared sections, cards, testimonials fixture, JSON-LD component (runs before every page task)

**Owns:** `apps/marketing/src/components/sections/**`, `apps/marketing/src/components/cards/**`, `apps/marketing/src/components/seo/JsonLd.tsx`, `packages/sample-data/src/fixtures/testimonials.ts`, `packages/sample-data/src/index.ts`, `packages/sample-data/src/sample-data.test.ts`.

- [ ] **Step 1: Testimonials fixture** per B.4 in `packages/sample-data`, exported from its index, with a test asserting six entries, `placeholder: true` on each, and all four locale quotes present (`en`, `sr-Latn`, `sr-Cyrl`, `hu`; generate the Cyrillic once with `node -e` and `packages/i18n/scripts/transliterate-core.mjs`, paste the result).
- [ ] **Step 2: JSON-LD component** `components/seo/JsonLd.tsx`: `{ data: Record<string, unknown> }` rendered as `<script type="application/ld+json">` with `JSON.stringify` and `<` escaped as `\u003c`; test.
- [ ] **Step 3: Sections and cards** exactly per B.2 (names, props, behaviour), each with a colocated `.test.tsx` (renders props, heading levels, landmarks, keyboard where interactive, axe via `src/test/axe.ts`). `FaqSection` renders `Accordion` from `@nestself/ui` and `JsonLd` with `FAQPage`. `TestimonialsSection` uses `Avatar` initials and sets `data-placeholder="true"`. `PageHero` renders the only `h1`; `variant: 'collage'` is an extra variant that shows one large photo plus two small ones (`photos: [{key, alt}, {key, alt}, {key, alt}]`). Icons map in `sections/icons.ts` with the whitelist from B.2. Cards use `Card interactive` with the title as the single link. Export everything from `components/sections/index.ts` and `components/cards/index.ts`.
- [ ] **Step 4: Storybook-free visual check.** Render a scratch page? No: page tasks will screenshot real pages. Instead write one `sections.visual.test.tsx` that mounts every section with sample props and asserts no axe violations and no console errors.

Verification: `pnpm --filter @nestself/marketing lint && pnpm --filter @nestself/marketing typecheck && pnpm --filter @nestself/marketing test && pnpm --filter @nestself/sample-data test`

### Task B1b: Catalog keys, chrome, home page

**Owns:** `apps/marketing/src/components/chrome/**`, `apps/marketing/src/app/[locale]/layout.tsx`, `apps/marketing/src/app/[locale]/page.tsx`, `apps/marketing/src/app/[locale]/content.ts`, `apps/marketing/content/pages/home/**`, `apps/marketing/src/components/home/**` (delete what the new home no longer uses), `apps/marketing/src/components/site-chrome.tsx` (replace), `apps/marketing/src/components/skip-link-wrapper.tsx`, `apps/marketing/src/components/credits-dialog.tsx` (keep), `apps/marketing/src/lib/site.ts`, `apps/marketing/src/components/sections/PrivacySection.tsx` (moved from home), `packages/i18n/locales/*/marketing.json` (shared keys only), `e2e/pages/marketing/b1.ts`.

- [ ] **Step 1: Shared catalog keys.** Add the keys listed in B.3 to `en`, `sr-Latn` and `hu` `marketing.json` (translate carefully; Serbian ekavian, Hungarian sentence case) and regenerate Cyrillic (`pnpm --filter @nestself/i18n build:cyrillic`). Keep every existing key that other pages still use; delete only `nav.findSupport`, `nav.howItWorks`, `nav.lifeBeyondWork` if nothing references them (grep first).
- [ ] **Step 2: Chrome.** `components/chrome/SiteHeaderBar.tsx` (client; wraps `SiteHeader` with the B.3 links, `aria-current` from the current pathname via `usePathname`, actions: `LocaleSwitcher` + `LinkButton` to `/${locale}/demo`), `components/chrome/LocaleSwitcher.tsx` (client; a labelled `<nav aria-label>` listing the four locales as links to the same pathname under each locale prefix, current one `aria-current="true"`, each link sets the `NEXT_LOCALE` cookie on click via `document.cookie` before navigation; native names from `localeMeta`), `components/chrome/SiteFooter.tsx` (four columns per B.3, locale switcher, tagline, credits dialog link; no "placeholder" footnote). Replace `site-chrome.tsx` usage in `[locale]/layout.tsx`: remove the `SampleDataBanner` from marketing (this site has no sample mode), keep `SkipLinkWrapper`, `Providers`, `DevThemeStudio`. Header and footer live outside `<main>`.
- [ ] **Step 3: Home page** per B.1 (`app/[locale]/content.ts` + `content/pages/home/en.json`). Sections in order: `PageHero` collage (`home-hero-kitchen` large, `home-hero-walk` and `family-cooking` small; primary Request a demo to `/demo`, secondary For employees to `/for-employees`), `TrustStrip` (licensed professionals; confidential by design; Serbian, Hungarian and English; psychological, legal and financial), `FeatureGrid` of the three services linking to `/services/therapy`, `/services/legal-consultation`, `/services/financial-guidance`, `StepsSection` "How it works for employees" (activate with your work email; choose an area and a time; talk, in your language; keep going with follow-ups and the library), `SplitSection` for employers (photo `employers-hr-meeting`, bullets: launch in weeks with a communications toolkit; anonymised insights for groups of 10 or more; manager resources and team polls; CTA Request a demo), `SplitSection` "Life beyond work" (photo `family-park-walk`, family coverage where included), `ResourceTeasers` fed by `listEntries` for articles and webinars and `listAssessments` (renders nothing while empty), `TestimonialsSection` (SAMPLE_TESTIMONIALS, quote in the current locale), the existing privacy section preserved as `PrivacySection` with its dialog and `data-testid="privacy-trigger"` (the keyboard e2e test depends on it), `FaqSection` (six questions: who can use it; is it confidential; what does it cost employees; how fast can we launch; which languages; what if someone is in crisis), `CtaBand`. Delete the old `components/home/*` sections that are no longer used.
- [ ] **Step 4: JSON-LD in the layout:** `Organization` (name NestSelf, url, `areaServed` RS and HU, `availableLanguage` en, sr, hu) and `WebSite` (`inLanguage`).
- [ ] **Step 5: Tests, screenshots, registry.** `LocaleSwitcher` test (four links, current marked, cookie set on click); header test (links, current page); `e2e/pages/marketing/b1.ts`: `marketing-home` (en), `-dark`, `-sr-cyrl`, `-hu`. Screenshots per rule 9 for `/en` and `/hu` at both widths; check the header collapses to the menu button under 760 px, the locale switcher fits at 390 px, Hungarian long words wrap without overflow, and no image shows a face cropped at the forehead.

Verification: `pnpm --filter @nestself/marketing lint && pnpm --filter @nestself/marketing typecheck && pnpm --filter @nestself/marketing test && pnpm --filter @nestself/i18n check && CONTENT_ALLOW_MISSING_LOCALES=1 pnpm --filter @nestself/marketing check`

### Task B2: Employers, employees, managers, plans, about

**Owns:** see B.0 plus `e2e/pages/marketing/b2.ts`.

Each page follows B.1 (content module + `en.json` + server page + metadata). Sections (all from B.2):

- `/for-employers` (photo `employers-hr-meeting`; the old `/employers` route becomes a `permanentRedirect` to it): hero (primary Request a demo to `/demo`, secondary See plans); `FeatureGrid` "What your people get" (three services + webinars and library + self-assessments + family coverage where included); `SplitSection` "What HR gets" (anonymised insights with a minimum group size of 10; launch and communications toolkit; manager resources; quarterly reviews with your NestSelf contact); `StepsSection` "How a launch works" (kick-off and plan configuration; eligibility file and access setup; communications toolkit in your languages; go-live and manager briefing; reviews); `SplitSection` "Confidentiality and compliance" (`lock-key`: GDPR, data processing agreement, no individual-level data to the employer, professionals bound by professional secrecy); `FaqSection` (eight employer questions); `CtaBand`.
- `/for-employees` (photo `employees-break`): hero (primary Open the workspace to `WORKSPACE_URL`, secondary Check if your employer offers NestSelf to `/contact`); `FeatureGrid` "What you can use"; `StepsSection` "How to start"; `SplitSection` "Who sees what" linking to `/privacy-model`; `SplitSection` "For your family" (photo `family-cooking`, where included); `FaqSection` (eight employee questions, including cost: "free for you where your employer covers it; your coverage is shown before you confirm anything"); `CtaBand`.
- `/for-managers` (photo `manager-one-on-one`): hero; `FeatureGrid` (team polls, channels, conversation guides, when and how to point someone to support); `StepsSection` "Supporting someone on your team" (notice; ask privately; listen without diagnosing; point to NestSelf; follow up); `ResourceTeasers` filtered to topic `managers` (may render empty); `CtaBand`.
- `/plans` (hero variant quiet): `PlansSection` with three tiers, no prices (Essentials: psychological support, library, webinars; Complete: adds legal and financial consultations, manager tools, HR insights; Enterprise: multi-country, SSO, custom reporting, dedicated contact), a note "Priced per eligible employee per month; quote based on headcount, countries and plan"; `FeatureGrid` "In every plan" (confidentiality, Serbian, Hungarian and English, launch toolkit, accessibility); `FaqSection` (six pricing questions); `CtaBand` "Request a quote".
- `/about` (photo `about-studio`): hero; `SplitSection` mission (why workplace support should include legal and financial questions, not only therapy); `StepsSection` "How we work with professionals" (licence verification; interview and references; code of ethics and supervision; languages; ongoing feedback); "Team" as a `FeatureGrid`-like list of roles with `Avatar` initials (founders, clinical lead, legal lead, financial lead, operations) and no personal names; "Where we are" (Belgrade and Budapest, remote across both countries); `CtaBand` Contact us. - `/faq`: hero quiet; two `FaqSection`s, "For employers" (the 12 employer questions in the market guide section 5) and "For employees" (the 12 employee questions), answers in the B.6 voice; `CtaBand`.

- [ ] Content, pages, metadata, `e2e/pages/marketing/b2.ts` (six `en` entries, `hu` and `sr-Cyrl` for for-employers), screenshots for all six pages in `en` and `hu` at both widths.

Verification: `pnpm --filter @nestself/marketing lint && pnpm --filter @nestself/marketing typecheck && pnpm --filter @nestself/marketing test && CONTENT_ALLOW_MISSING_LOCALES=1 pnpm --filter @nestself/marketing check`

### Task B3: Services overview and three service pages

**Owns:** see B.0 plus `e2e/pages/marketing/b3.ts`.

- `/services` (hero quiet, photo `home-hero-office`): three `SplitSection`s (psychological with `psychological-inperson`, legal with `legal-consultation`, financial with `financial-planning`, alternating `reverse`), `StepsSection` "How a session works" (choose the area; pick a professional and a time, video or in person where available; your coverage and any cost are shown before you confirm; talk; follow-ups and notes stay with you), `FaqSection` (six), `CtaBand`.
- `/services/therapy` (offering name "Therapy & Counselling"): hero; `FeatureGrid` "What it covers" (stress and burnout; anxiety and low mood; relationships and family; grief and change; sleep; conflict at work); `StepsSection` "How it works" (50-minute sessions; video or in person where available; Serbian, Hungarian or English; follow-ups); `SplitSection` "Who you will talk to" (licensed psychologists and psychotherapists, vetted as described on About; roles only, photo `psychological-video-call`); crisis block as a distinct `Alert`-styled section with the emergency numbers; `FaqSection` (eight, including "Will my employer know?", "Is this therapy or counselling?", "How many sessions?"); `CtaBand`.
- `/services/legal-consultation` ("Legal Consultation"): hero; covers (employment contracts and termination; housing and tenancy; family matters basics; consumer issues; debt and enforcement; documents and administration); how it works (30 to 45 minute consultation; written summary of next steps; referral when representation is needed); `SplitSection` "What it is not" (not court representation; not a substitute for a retained lawyer; not for disputes with your employer, where we point you to independent help); `FaqSection`; `CtaBand`.
- `/services/financial-guidance` ("Financial Guidance"): hero; covers (budgeting; debt; savings and emergency fund; loans and mortgages basics; taxes basics; pensions); how it works; `SplitSection` "Independent" (consultants sell no products and receive no commissions); `FaqSection`; `CtaBand`.
- `/support` becomes a redirect: `app/[locale]/support/page.tsx` calls `permanentRedirect(\`/${locale}/services\`)`; delete `support-content.tsx` and the `marketing:pages.support.*` keys only if nothing else uses them.

- [ ] Content, pages, metadata, `e2e/pages/marketing/b3.ts` (four `en` entries, `hu` and `sr-Cyrl` for therapy), screenshots for all four in `en` and `hu`.

Verification: as B2.

### Task B4a: English articles and webinars (content only, runs early)

**Owns:** `apps/marketing/content/articles/**`, `apps/marketing/content/webinars/**`.

- [ ] Nine articles as `content/articles/<slug>/en.mdx` (600 to 900 words each; frontmatter per the A2 `ArticleFrontmatterSchema`; headings; one `<Callout kind="tip">` or `note`; practical steps; no invented statistics; `author: "NestSelf editorial team"`; `cover` from the keys in B.6; `related` slugs among the nine): psychological: `signs-of-burnout-first-steps`, `sleep-stress-and-the-working-week`, `talking-to-your-manager-about-workload`; legal: `employment-contract-what-to-check` (general, both countries, points to a consultation for specifics), `renting-a-flat-deposits-notice-repairs`; financial: `three-month-buffer-on-a-normal-salary`, `reading-a-loan-offer-without-jargon`; family: `supporting-a-partner-through-a-hard-time`; managers: `one-on-ones-people-look-forward-to`. Every article ends with a short "When to talk to someone" paragraph pointing to the matching service.
- [ ] Six webinars as `content/webinars/<slug>/en.mdx` (frontmatter per `WebinarFrontmatterSchema`; body 150 to 300 words: what you will learn, who it is for, format): three `live` (`startsAt` on weekday evenings in November and December 2026, Europe/Belgrade offset `+01:00`, 45 or 60 minutes) and three `on-demand` (`recordingAvailable: true`), across psychological, legal, financial and managers topics; speakers as roles only ("Clinical psychologist, NestSelf network"; "Employment lawyer, NestSelf network"; "Financial consultant, NestSelf network"); `languages` mixing `sr`, `hu`, `en`; covers `webinar-speaker`, `webinar-viewer` and article keys.
- [ ] Verify with `CONTENT_ALLOW_MISSING_LOCALES=1 pnpm --filter @nestself/marketing check` (every file validates, covers exist, related slugs exist) and `pnpm --filter @nestself/marketing test`.

### Task B4b: Resources hub, webinars and articles pages, webinar registration form

**Owns:** `apps/marketing/src/app/[locale]/{webinars,articles,resources}/**`, `apps/marketing/content/pages/{resources,webinars,articles}/**`, `apps/marketing/src/components/forms/WebinarRegistrationForm.tsx` (+ test), `e2e/pages/marketing/b4.ts`.

- `/resources`: hero quiet; three sections (Webinars, Articles, Tools) each with up to three cards and a See all link; tools cards come from `listAssessments` and `listEntries('tools')` (may be empty until B5 lands; render the section only when non-empty).
- `/webinars`: hero quiet; "Upcoming" (format `live`, `startsAt` in the future, ascending) and "On demand" sections of `WebinarCard`s; dates formatted with `formatDateTime` from `@nestself/i18n` in `Europe/Belgrade`.
- `/webinars/[slug]`: `generateStaticParams` from `listSlugs('webinars')` × locales; `Breadcrumbs`; cover `PhotoFigure`; details `DataList`-style block (date and time with time zone label, duration, format, languages, speaker role and area); MDX body via `renderMdx`; `WebinarRegistrationForm` (client; fields name, email, company optional, consent checkbox with privacy policy link; honeypot `website` field visually hidden and `tabIndex={-1}` `aria-hidden`; validates with `WebinarRegistrationSchema` from `@nestself/contracts` before `fetch('/api/leads/webinar-registrations', { method: 'POST' })`; shows `FormErrorSummary` on invalid; success state "You are registered; we will email the link"; 503 or network failure shows "We could not send your registration" with the contact email from `NEXT_PUBLIC_CONTACT_EMAIL`); for `on-demand` webinars the form is replaced by a "Watch the recording" note that the recording will be available in the workspace; `Event` JSON-LD with `eventAttendanceMode: OnlineEventAttendanceMode`, `eventStatus: EventScheduled`, `organizer` NestSelf, `inLanguage`; related articles by topic.
- `/articles`: hero quiet; topic filter as links (`?topic=`) rendered as `Chip`-like links with `aria-current`; `ArticleCard` grid sorted by date.
- `/articles/[slug]`: `generateStaticParams`; `Breadcrumbs`; meta line (topic, published date, reading time, author role); cover; `ProseLayout` with MDX; "This article is general information, not medical, legal or financial advice" footer with a link to the matching service; related articles; `Article` JSON-LD; `CtaBand`.

- [ ] Content, pages, form with tests (valid submit calls fetch with the right body; invalid shows the error summary and focuses it; 503 shows the failure message), `e2e/pages/marketing/b4.ts` (resources, webinars, one webinar detail, articles, one article detail in `en`; `hu` for the article detail), screenshots per rule 9.

Verification: as B2.

### Task B5a: Assessment data, guides and scoring module (content and logic, runs early)

**Owns:** `apps/marketing/content/assessments/**`, `apps/marketing/content/tools/**`, `apps/marketing/src/components/assessment/scoring.ts`, `apps/marketing/src/components/assessment/scoring.test.ts`.

- Content: assessments in `content/assessments/<slug>/en.json` using the A2 schema. Licensing is settled by the market guide (docs/research/2026-10-21-market-language-guide.md section 4): the WHO-5 is NOT used (its licence is disputed, likely non-commercial since 2024); MBI, WEMWBS and PSS-10 are NOT used (paid or unclear licences). Five assessments: - `wellbeing-check-in` (NestSelf-authored, eight items about energy, sleep, mood, connection, focus, enjoyment, worry, outlook over the last two weeks; five options scored 0 to 4; `scoring.method: 'sum-scaled-100'`; bands 0 to 39 "Low right now", 40 to 69 "Mixed", 70 to 100 "Steady"; `instrument.name` says "NestSelf wellbeing check-in (not a validated clinical instrument)", `source` points to `/privacy-model`-free URL such as `https://nestself.example/tools/wellbeing-check-in` is NOT allowed: use the guide URL `https://www.who.int/news-room/fact-sheets/detail/mental-health-at-work` as `source` for background reading and say so in `licence`). - `anxiety-check` (GAD-7, public domain: seven items, four options scored 0 to 3 "Not at all" to "Nearly every day", `scoring.method: 'sum'`, score 0 to 21; bands 0 to 4 "Minimal", 5 to 9 "Mild", 10 to 14 "Moderate", 15 to 21 "Severe"; bands at 10 and above say plainly that talking to a professional soon is a good next step; `instrument.source` `https://www.phqscreeners.com/`, `licence` "Developed by Drs. Robert L. Spitzer, Janet B.W. Williams, Kurt Kroenke and colleagues, with an educational grant from Pfizer Inc. No permission required to reproduce, translate, display or distribute."). - `burnout-check` (Copenhagen Burnout Inventory, personal burnout scale, six items, five options scored 100/75/50/25/0, `scoring.method: 'mean'`; bands under 50, 50 to 74, 75 to 99, 100; `source` `https://nfa.dk/media/hl5nbers/cbi-first-edition.pdf`, `licence` "Kristensen, T. S., Borritz, M., Villadsen, E., & Christensen, K. B. (2005). The Copenhagen Burnout Inventory. Free to use with attribution."). - `workplace-stress-check` and `financial-wellbeing-check` (NestSelf-authored, eight items each, five options, `scoring.method: 'sum-scaled-100'`, explicitly "not a validated clinical instrument" in `instrument.name`, bands that only suggest next steps). Every assessment: the `disclaimer` is exactly "This tool is not a medical device and does not provide a diagnosis. It is for informational purposes only. For a clinical evaluation, talk to a licensed professional. If you are in crisis, call the emergency number." and the `crisis` block lists Serbia 112 (emergency), 194 (ambulance), Centar Srce 0800 300 303; Hungary 112 (emergency), 104 (ambulance), Lelki Elsősegély Telefonszolgálat 116 123. Guides in `content/tools/<slug>/en.mdx`: `conversation-planner` (kind planner), `monthly-budget-worksheet` (planner, with a table), `legal-consultation-checklist` (checklist).
- Scoring in `components/assessment/scoring.ts`: `export function scoreAssessment(assessment: Assessment, answers: Record<string, number>): { raw: number; score: number; band: ScoringBand }` where `score` is normalised to the assessment's `scoring.min..max` range as the content defines it (GAD-7: plain sum; CBI: mean of item scores; NestSelf-authored checks: sum scaled to 0 to 100) and `band` is the matching band; make the method explicit through a `scoring.method: 'sum' | 'mean' | 'sum-scaled-100'` field that you add to the assessment JSON and to a small extension of the A2 schema ONLY if the schema does not already have it (coordinate by reading `src/content/schemas.ts`; if you must add the optional field, do it in a backwards-compatible way and run the content layer tests). Unit tests for all five assessments: minimum, maximum and every band boundary.
- [ ] Verify with `CONTENT_ALLOW_MISSING_LOCALES=1 pnpm --filter @nestself/marketing check` and `pnpm --filter @nestself/marketing test`.

### Task B5b: Tools hub, tool pages and the assessment runner

**Owns:** `apps/marketing/src/app/[locale]/tools/**`, `apps/marketing/src/components/assessment/**` (except `scoring.ts`, which exists), `apps/marketing/content/pages/tools/**`, `e2e/pages/marketing/b5.ts`.

- `/tools`: hero quiet (photo `tools-notebook`); "Self-assessments" section of `AssessmentCard`s; "Guides and planners" section of `ToolCard`s; a short paragraph on what assessments are and are not.
- `/tools/[slug]`: resolve assessment first (`getAssessment`), else guide (`getEntry('tools')`), else `notFound()`; `generateStaticParams` from both slug lists. Assessment page: `Breadcrumbs`, intro, duration and question count, "Nothing you answer here is sent anywhere or stored" line, `AssessmentRunner`. Guide page: `ProseLayout` with MDX and a CTA to the matching service.
- `AssessmentRunner` (`components/assessment/AssessmentRunner.tsx`, client): props `{ assessment: Assessment; labels: { start, next, back, finish, restart, questionOf, result, yourScore, nothingStored, talkToSomeone, relatedReading } ; links: { talk: string; related: string } }` (labels come from the tools page content JSON (`runner` block in `content/pages/tools/en.json`), not from i18next catalogs). Behaviour: intro screen with Start; one question per screen using `RadioGroup` from `@nestself/ui` (legend = question text); Next disabled until an option is chosen; Back keeps answers; `ProgressBar` with `questionOf` label; result screen computes the score with `scoreAssessment` and finds the band, shows band title, body, next step, the disclaimer, the crisis block, two `LinkButton`s, and Restart; focus moves to the new question heading on each step and to the result heading at the end; announces step changes through `useAnnouncer`/`LiveRegion` if available. Use `scoreAssessment` from `components/assessment/scoring.ts` (exists). Component test: complete the wellbeing check-in by keyboard only and assert the result band; Back preserves the answer; Restart returns to the intro.


- [ ] Pages, runner, tests, `e2e/pages/marketing/b5.ts` (tools hub, wellbeing check-in intro, its result state via a `prepare` action that completes the assessment, the anxiety check intro, one guide; `hu` for the hub), screenshots per rule 9 including the result state.

Verification: as B2.

### Task B6: Contact and demo form, route handlers, legal, accessibility, credits, privacy model

**Owns:** see B.0 plus `e2e/pages/marketing/b6.ts`.

- `src/lib/leads.ts`: `export async function submitLead<T>(path: 'demo-requests' | 'contact' | 'webinar-registrations', body: T): Promise<{ ok: true; data: LeadAccepted } | { ok: false; status: number; issues?: { path: (string | number)[]; message: string }[] }>` (client-safe fetch wrapper; network failure returns `{ ok: false, status: 0 }`).
- Route handlers `src/app/api/leads/[kind]/route.ts` (`POST` only): map `kind` to the contracts schema (`demo-requests` to `DemoRequestSchema`, `contact` to `ContactMessageSchema`, `webinar-registrations` to `WebinarRegistrationSchema`; unknown kind 404); parse JSON (400 on invalid JSON or schema failure with `issues`); if `process.env.API_URL` is unset return 503 `{ error: 'not_configured' }`; otherwise `fetch(\`${API_URL}/api/leads/${kind}\`, { method: 'POST', headers: { 'content-type': 'application/json' }, body })` with a 10 s timeout and return the upstream status and body; never log bodies. Tests in `route.test.ts` with `vi.stubGlobal('fetch')`: 400, 503, 202 pass-through, 404 kind, upstream 429 pass-through.
- `/demo`: hero quiet ("Request a demo"); two columns (`DemoRequestForm` left, right column: what happens next (a person replies, a 30-minute call, a proposal), contact details); `/contact`: hero quiet; two columns (`ContactForm` left, contact details right: `NEXT_PUBLIC_CONTACT_EMAIL` with default `hello@nestself.example` and a clear code comment that the real address is a launch-checklist item, offices "Belgrade and Budapest", a note that demo requests are answered by a person, no response-time promise); `DemoRequestForm` (client; fields full name (one field: Hungarian family-name-first order makes split fields awkward), work email (soft hint, not a block, when the domain is a common free-mail provider), company, job title, company size `Select` with the buckets `1-50`, `51-200`, `201-500`, `501-1000`, `1000+`, country `Select` RS/HU/Other pre-selected from the locale (`sr-*` → RS, `hu` → HU), how did you hear about us `Select` optional (search, referral, event, social, other), message optional, consent checkbox unchecked by default with the privacy policy link and the exact consent sentence from the market guide section 5, honeypot; validates with `DemoRequestSchema`; `FormErrorSummary` focus on invalid; success panel "We received your request"; 503 and network failure panel with the email address); `ContactForm` (name, email, subject, message, consent) on `/contact`; both forms share `components/forms/LeadFormShell.tsx` (status panels, error summary, honeypot field, submit button with pending state).
- `/privacy-model`: keep the existing access-matrix content, wrap it in the new page conventions (hero quiet, breadcrumbs), add a short "In practice" `StepsSection` (what happens when you book; what your employer sees; what we keep and for how long: "session notes stay with the professional; we keep booking records as long as the law requires").
- `/legal/privacy-policy`, `/legal/terms`, `/legal/cookies`, `/legal/imprint`: page content schema `{ meta, title, updatedAt, intro, sections: { heading, paragraphs: string[], bullets?: string[] }[] }` rendered with `ProseLayout`. Privacy policy: controller (fields `[Company name]`, `[Address]`, `[PIB]`, `[Matični broj]`, `[Cégjegyzékszám]`, `[Adószám]` clearly marked as to be completed before launch), data we process for the website (contact and demo requests, webinar registrations, the `NEXT_LOCALE` cookie), purposes and legal bases (GDPR Art. 6(1)(b) and (f); Serbian Law on Personal Data Protection), retention, processors (hosting, email provider to be named), rights and how to exercise them, supervisory authorities (Poverenik in Serbia, NAIH in Hungary), contact. Also state, in plain words, that the wellbeing check-ins run entirely in the browser and that NestSelf stores none of the answers or results (so no health data is processed by this website), that no analytics or marketing cookies are set, and that there is no automated decision-making. The guide's compliance section 6 lists the GDPR Article 13 and 14 elements, the Serbian ZZPL specifics (Poverenik; matični broj and PIB) and the Hungarian ones (NAIH; Ekertv impresszum fields: teljes név, cégjegyzékszám, adószám, székhely, e-mail, telefonszám); the Serbian legal information page under Zakon o elektronskoj trgovini needs naziv, sedište, matični broj, PIB, e-mail, telefon, so `/legal/imprint` carries both the Hungarian impresszum block and the Serbian pravne informacije block. Legal texts in Hungarian use the formal "Ön" (translation stage), everything else "te". Terms: website use, no professional advice, intellectual property, liability, governing law placeholders. Cookies: only the functional `NEXT_LOCALE` cookie and no analytics; how to clear it. Imprint (Impresszum): the Hungarian Ekertv. required fields as marked placeholders (service provider name, seat, contact, registering court and company number, tax number, hosting provider), plus the Serbian company identifiers. Every legal page shows "Draft for legal review" nowhere in the UI, but the content JSON carries `"draft": true` and the launch checklist in the spec lists the legal review.
- `/accessibility`: statement (target WCAG 2.2 AA; what we test: keyboard, screen reader labels, contrast, 320 px reflow, reduced motion, text scaling; known limitations: none claimed beyond "third-party video players embedded in webinars may differ"; how to report a problem via the contact email).
- `/credits`: keep the existing page and add a "Generated imagery" section listing the generated photo keys with the generator credit from `photos.json`, and the fonts and icons sections.

- [ ] Pages, forms, handlers, tests (forms: valid submit, invalid with focus on the summary, 503 panel; handlers as above), `e2e/pages/marketing/b6.ts` (demo, demo with the error state via a `prepare` action that submits the empty form, contact, privacy model, all four legal pages, accessibility, credits in `en`; `hu` for demo), screenshots per rule 9 including the contact error state at 390 px.

Verification: as B2.

## Phase C: integration

### Task C0: Copy review against the market language guide

Runs once `docs/research/2026-10-21-market-language-guide.md` exists, after Phase B and before C2. Reviewers (one for employer-facing pages, one for employee-facing and resources, one for legal and trust pages) read the guide's sections 1, 2 and 5 and every English content file and catalog key in their area, then edit the English directly: adopt the recommended offering names and recurring market phrasings, remove anything the guide flags (jargon, promises, claims), tighten headlines to the voice in B.6, and keep the structure and keys unchanged. Each reports a list of files touched and the three most important wording changes. The orchestrator re-runs the marketing tests and the content check afterwards.

### Task C1: SEO

**Owns:** `apps/marketing/src/app/sitemap.ts`, `apps/marketing/src/app/robots.ts`, `apps/marketing/src/app/[locale]/opengraph-image.tsx`, `apps/marketing/src/app/[locale]/layout.tsx` (metadata only), `apps/marketing/src/i18n/metadata.ts`, `apps/marketing/next.config.ts` (redirects only).

- [ ] `metadata.ts`: `metadataBase` from `NEXT_PUBLIC_SITE_URL`; `localizedMetadata` adds `openGraph.images` (the locale OG image) and `twitter.card = 'summary_large_image'`; keep hreflang alternates for the four locales and `x-default`.
- [ ] `opengraph-image.tsx` under `[locale]`: `ImageResponse` 1200×630 using the `og-wide` JPEG from `public/images/og-wide/og-wide-1280.jpg` as background, a dark gradient, the brand word and the localised site tagline (`marketing:meta.ogTagline`, add in all locales) in Onest Bold loaded from `packages/assets/fonts/native/Onest-Bold.ttf` via `fs`.
- [ ] `sitemap.ts`: static routes from a single `ROUTES` list (every page in the spec sitemap) × locales with alternates, plus dynamic entries from `listSlugs('articles' | 'webinars' | 'tools')` and `listAssessmentSlugs()`, `lastModified` from frontmatter where available. Unit test the route list against the `app/[locale]` directory tree so a new page cannot be forgotten.
- [ ] `next.config.ts`: `redirects()` for `/:locale/support` to `/:locale/services` (permanent) in addition to the page-level redirect (belt and braces for static hosting).
- [ ] Verify with `pnpm --filter @nestself/marketing build` and by fetching `/sitemap.xml`, `/en/opengraph-image` and one page's `<head>` from `next start` on port 3100; report the alternates for one URL.

### Task C2: Translation of all new content and strings (sr-Latn and hu; Cyrillic generated)

Run as parallel translators on disjoint files, then a reviewer per language.

- [ ] Translators (each owns a disjoint set): pages JSON (`content/pages/**/en.json` → `sr-Latn.json`, `hu.json`), articles (`content/articles/*/en.mdx` → two siblings), webinars and tools (`content/webinars/*/en.mdx`, `content/tools/*/en.mdx`), assessments (`content/assessments/*/en.json`). Rules: same structure and keys; keep frontmatter keys, `cover`, `topic`, dates, URLs, slugs and brand names untouched; Serbian ekavian with correct diacritics (č ć š ž đ), Hungarian with correct diacritics and sentence case; emergency numbers unchanged; instrument names unchanged; placeholders in square brackets stay as they are; measurement of reading time is recomputed automatically. Terminology from `docs/research/2026-10-21-market-language-guide.md` section 8 when present, otherwise the list in Task A1 Step 4. Register: Serbian formal "Vi" everywhere; Hungarian informal "te" in all marketing and UI copy, formal "Ön" (never "maga") only in the legal pages. Cyrillic is generated, so write Latin Serbian with the guide's transliteration rules in mind: brand names and international abbreviations stay Latin, no Latin-script islands (use full Serbian terms such as "blagostanje zaposlenih" rather than "wellbeing").
- [ ] Reviewers: one Serbian, one Hungarian; each reads every translated file, fixes grammar, register, false friends and anglicisms directly, and reports what they changed.
- [ ] Orchestrator: `pnpm --filter @nestself/marketing content:cyrillic`, then `CONTENT_STRICT=1 pnpm --filter @nestself/marketing check` and `pnpm --filter @nestself/i18n check` must pass.

### Task C3: e2e registration, baselines, visual review loop

- [ ] Merge `e2e/pages/marketing/*.ts` fragments into `e2e/pages/marketing.ts` (import and spread; merge `prepareActions`); delete the old entries that no longer exist (`marketing-support`).
- [ ] With the three dev servers up, run `pnpm exec playwright test e2e/screenshots.spec.ts --update-snapshots --grep marketing` to generate baselines, then `pnpm exec playwright test --grep marketing` (screenshots, a11y, reflow) and fix every failure at the source.
- [ ] Visual review: open every `e2e/__screenshots__/{mobile-390,desktop-1440}/marketing-*.png` with the Read tool (contact sheets are fine for a first pass, single images for anything suspicious) and record issues per page: overflow, orphaned headings, cropped faces, inconsistent spacing, unreadable contrast on photos, Hungarian or Serbian words breaking layouts, missing images (grey boxes), empty sections. Fix, regenerate, re-review until clean. The orchestrator does a final pass itself.
- [ ] Keyboard tests added to `e2e/a11y.spec.ts`: assessment completable by keyboard; demo form empty submit focuses the error summary; locale switcher changes `html[lang]` and the URL.

### Task C4: Final verification, docs, commit

- [ ] `CLAUDE.md` content rule updated: testimonials are placeholders from `SAMPLE_TESTIMONIALS` until real consented quotes exist; the rest unchanged. `apps/marketing/README.md` route table and "No-analytics policy" paragraph updated to the truth (forms exist; no analytics; placeholder testimonials). Spec section 8 launch checklist reviewed against reality.
- [ ] `pnpm lint && pnpm lint:root && pnpm typecheck && pnpm test && CONTENT_STRICT=1 pnpm check && pnpm build && pnpm e2e` all green; `pnpm --filter @nestself/ui storybook:build` green.
- [ ] Commit in logical units (foundations; pages; content and translations; e2e baselines; docker), update memory, report.

## Phase D: fixes from the first visual and accessibility pass

Findings came from the Playwright pass (axe, 320 px reflow) and from a visual review of all 109 marketing screenshots. Each task below owns disjoint files. Do not touch apps/marketing/content/{articles,webinars,tools,assessments} (a translation wave is writing their sr-Latn and hu siblings right now).

### Task D1: Friendly form validation and labelled select options

**Owns:** `apps/marketing/src/components/forms/**`, `apps/marketing/content/pages/demo/**`, `apps/marketing/content/pages/contact/**`, `apps/marketing/content/pages/webinars/**` (only the registration-form labels block), `apps/marketing/src/app/[locale]/demo/content.ts`, `apps/marketing/src/app/[locale]/contact/content.ts`, `apps/marketing/src/app/[locale]/webinars/content.ts` (schema additions only), `apps/marketing/src/lib/leads.ts`.

Problem: the error summaries show zod's developer messages ("Too small: expected string to have >=1 characters", "Invalid input: expected true", "Invalid option: expected one of \"1-50\"|...") and the country select shows raw codes ("OTHER", "HU").

- [ ] Add a `validation` block to the demo, contact and webinar page content schemas and `en.json`: `{ required: "Please fill in {{field}}.", email: "Enter a valid work email address, for example name@company.com.", consent: "Please agree to the privacy policy so we can reply.", select: "Please choose an option for {{field}}.", tooLong: "{{field}} is too long." }` plus a `fields` block already present (labels). Map every zod issue to one of these by issue code and path (`too_small` on a string → required; `invalid_format`/email → email; `invalid_value` on `consent` → consent; `invalid_value`/`invalid_enum_value` on selects → select; `too_big` → tooLong), interpolating the field label from the page content, in one shared helper in `src/lib/leads.ts` (`describeIssues(issues, labels, validation)`), used by all three forms. The summary links keep pointing at the field ids; inline field errors show the same friendly message.
- [ ] Country, company-size and heard-about selects get human labels from the page content (`countries: { RS: "Serbia", HU: "Hungary", OTHER: "Other" }`, `companySizes: { "1-50": "1 to 50 employees", ... }`, `heardAbout: { search: "Search engine", referral: "Recommendation", event: "Event or conference", social: "Social media", other: "Other" }`) while still submitting the codes; the default country still follows the locale.
- [ ] Update the form tests: empty submit shows the friendly messages (not the zod text), a bad email shows the email message, selects render labels. Run `pnpm --filter @nestself/marketing test` and `pnpm --filter @nestself/marketing typecheck`, then screenshot `/en/demo` after an empty submit (the e2e prepare action is in `e2e/pages/marketing/b6.ts`) and look at it.

### Task D2: Legal, accessibility and prose page rendering

**Owns:** `apps/marketing/src/app/[locale]/legal/**`, `apps/marketing/src/app/[locale]/accessibility/**`, `apps/marketing/src/app/[locale]/credits/**`, `apps/marketing/src/components/sections/ProseLayout.tsx` (+ test), `apps/marketing/content/pages/legal-*/**`, `apps/marketing/content/pages/accessibility/**` (structure only, no wording changes).

Problem: the legal pages and the accessibility statement render their section headings and bullet lists as undifferentiated text in a narrow centred column, and show "Last updated: 2026-10-21" raw.

- [ ] Render each content section with `Heading level={2} typeRole="sectionTitle"` (numbered sections keep their number in the heading text), paragraphs as `Text` with vertical rhythm (`space-y-4` inside sections, `space-y-10` between sections), bullets as a real `<ul>` with list markers, and the "last updated" line through `formatDate` from `@nestself/i18n` in the page locale. If the content JSON stores headings and bullets inside paragraph strings, restructure the JSON into `sections[].heading`, `paragraphs[]`, `bullets[]` without changing any wording.
- [ ] `ProseLayout` starts at the left edge of the page container like every other page (no horizontal centering), with a reading width around 68ch and an optional aside slot on the right from 1024 px; keep the MDX article pages looking the same otherwise. Update its test.
- [ ] Verify with `pnpm --filter @nestself/marketing test && pnpm --filter @nestself/marketing typecheck`, then screenshot `/en/legal/privacy-policy`, `/en/accessibility` and `/en/articles/signs-of-burnout-first-steps` at both widths and look at them.

### Task D3: Locale-aware dates and labels on cards and teasers

**Owns:** `apps/marketing/src/app/[locale]/for-managers/**`, `apps/marketing/src/app/[locale]/page.tsx` (date formatting lines only), `apps/marketing/src/app/[locale]/resources/**`, `apps/marketing/src/app/[locale]/articles/**` (date formatting only), `apps/marketing/src/app/[locale]/webinars/**` (date formatting only), `apps/marketing/src/lib/dates.ts` (new).

Problem: the managers page passes raw `publishedAt` ("2026-10-08") to article cards and formats webinar dates with a hard-coded `'en'` locale; other pages format dates in different ways.

- [ ] Create `src/lib/dates.ts` with `formatArticleDate(iso, locale)` and `formatWebinarDateTime(iso, locale)` built on `formatDate`/`formatDateTime` from `@nestself/i18n` (time zone Europe/Belgrade; webinar format "12 November 2026, 18:00 CET" in English and the locale's natural equivalent), with unit tests for en, sr-Latn, sr-Cyrl and hu.
- [ ] Use them everywhere a date label is produced: home teasers, for-managers teasers, resources hub, articles list and detail, webinars list and detail. Grep for `toLocaleDateString`, `publishedAt` and `startsAt` in `apps/marketing/src/app` to find every site; no page may pass an ISO string straight to a card.
- [ ] Verify with tests and typecheck, then screenshot `/en/for-managers` and `/hu/for-managers` and look at the dates.

### Task D4: Visual polish on service, check-in, about and plans pages

**Owns:** `apps/marketing/src/app/[locale]/services/**` (page files), `apps/marketing/content/pages/services*/**`, `apps/marketing/src/app/[locale]/tools/**` (page files only; not the runner), `apps/marketing/content/pages/tools/**`, `apps/marketing/content/pages/about/**`, `apps/marketing/content/pages/plans/**`, `apps/marketing/src/app/[locale]/about/**`.

- [ ] Service pages open with `PageHero variant="split"` and a photo: overview `home-hero-office`, therapy `psychological-inperson`, legal consultation `legal-consultation`, financial guidance `financial-planning` (the later split sections then use a different photo than the hero: therapy "Who you will talk to" keeps `psychological-video-call`, legal "What it is not" uses `article-contract`, financial "Independent" uses `article-budget`).
- [ ] Check-in intro pages (`/tools/<assessment>`) get a photo in the intro (not in the runner): map topic to photo in the page file (`psychological` → `assessment-sofa`, `work` → `article-end-of-day`, `financial` → `financial-planning`, default `assessment-sofa`), shown beside the intro text at 1024 px and above it on phones, with a meaningful `alt` from the tools page content JSON (add `introPhotoAlt` per topic to `content/pages/tools/en.json`).
- [ ] About page: the "Why we built NestSelf" section uses `home-hero-office` instead of repeating the hero photo.
- [ ] Plans page: "designed to meet WCAG 2.1 Level AA" becomes "designed to meet WCAG 2.2 Level AA" (the accessibility statement targets 2.2).
- [ ] Verify with tests, typecheck and `CONTENT_ALLOW_MISSING_LOCALES=1 pnpm --filter @nestself/marketing check`, then screenshot `/en/services/therapy`, `/en/tools/wellbeing-check-in` and `/en/about` at both widths and look at them (faces must not be cropped by the hero crop; adjust the layout, never the photo files).

### Task D5: Stabilise the assessment runner keyboard test

**Owns:** `apps/marketing/src/components/assessment/AssessmentRunner.test.tsx` and, only if a real defect is found, `apps/marketing/src/components/assessment/AssessmentRunner.tsx`.

- [ ] Two reviewers saw the keyboard-only test fail intermittently. Run it 15 times in a loop (`for i in $(seq 1 15); do pnpm --filter @nestself/marketing exec vitest run src/components/assessment/AssessmentRunner.test.tsx --reporter=dot || echo FAIL $i; done`), find the race (focus moving before the new question renders, `fireEvent.keyDown` on the wrong element, missing `await` on `user.tab()`), fix it with `findBy*` queries and `waitFor` on focus rather than timeouts, and confirm 15 consecutive passes. If the component itself moves focus too early (before the heading exists), fix the component and keep the behaviour described in the plan (focus moves to the new question heading on each step).
