# NestSelf marketing site: design

Date: 2026-10-21. Status: approved for implementation by the brief ("go ahead and implement all marketing pages, first write what we need to implement"). Market research that informs naming, copy and imagery is in `docs/research/2026-10-21-market-language-guide.md`; this document references it rather than repeating it.

## 1. Goal and scope

Build the complete public marketing site in `apps/marketing` to a production-looking standard, in English, Serbian (Latin and Cyrillic) and Hungarian, with generated photography, and add Docker for Postgres, Redis and the API.

In scope:

- Every public page listed in section 3, with real copy in all four locales (Cyrillic generated from Latin).
- Resource content: webinars, articles, self-assessment tools and other tools, with a content layer that an editor can extend without touching components.
- Lead capture that really works end to end: demo request, contact and webinar registration are stored by the API.
- Generated imagery (people, families, workplaces) produced with the OpenAI image skill and delivered through the existing responsive image pipeline with credits and focal points.
- Placeholder testimonials, explicitly flagged in code and in the launch checklist (the brief allows mocked testimonials for this non-final version).
- Docker: `apps/api/Dockerfile`, Compose with Postgres, Redis and the API, ready for BullMQ later.
- Playwright screenshots of every page at 390 px and 1440 px, reviewed visually, plus axe and 320 px reflow.

Out of scope: workspace, admin and mobile features; authentication; payments; a CMS; analytics or cookie consent (no third-party cookies are set); email delivery (queued for the BullMQ phase); Android.

## 2. Audiences and offering

| Audience | What they need from the site | Primary CTA |
| --- | --- | --- |
| Employers: HR, people leaders, founders in Serbia and Hungary | Understand the programme, trust it (confidentiality, professionals, GDPR), see how it launches, request a demo | Request a demo |
| Employees of client companies (and family members where covered) | Understand what they can use, how confidential it is, and start using it | Open the workspace, or "Check if your employer offers NestSelf" |
| Managers | Resources for leading teams well, team polls and channels | Explore manager resources |

Offerings and their recommended names come from the research guide section 2 (EN, SR, HU). The working taxonomy:

1. Psychological support and psychotherapy sessions with licensed professionals.
2. Legal consultation.
3. Financial consultation.
4. Webinars: live and on-demand, with registration.
5. Articles: an editorial library by topic.
6. Self-assessment tools: short, non-diagnostic check-ins with clear next steps.
7. Other tools: practical guides and planners (conversation planner, budget planner, legal document checklist).
8. HR insights: anonymised, aggregated, with minimum group sizes.
9. Manager tools: team polls, channels, resources.
10. Family coverage: described as "where the employer's plan includes it", never promised.

## 3. Site map

All routes are prefixed with the locale (`/en`, `/sr-Latn`, `/sr-Cyrl`, `/hu`). English slugs are used in every locale (one URL structure, hreflang alternates); localised slugs are a later SEO step and are listed in the launch checklist.

| Route | Page | Audience | Primary CTA |
| --- | --- | --- | --- |
| `/` | Home | all | Request a demo; For employees |
| `/employers` | For employers | employers | Request a demo |
| `/employees` | For employees | employees | Open the workspace |
| `/services` | Services overview (replaces `/support`, which redirects) | all | Request a demo |
| `/services/psychological-support` | Psychological support | all | Request a demo / For employees |
| `/services/legal-consultation` | Legal consultation | all | same |
| `/services/financial-consultation` | Financial consultation | all | same |
| `/resources` | Resources hub (webinars, articles, tools) | all | Browse |
| `/webinars`, `/webinars/[slug]` | Webinar list and detail with registration | all | Register |
| `/articles`, `/articles/[slug]` | Article list and detail | all | Read; related CTA |
| `/tools`, `/tools/[slug]` | Self-assessments and other tools; interactive runner for assessments | all | Start |
| `/managers` | For managers | managers | Explore |
| `/plans` | Plans and pricing approach (quote based, no invented numbers) | employers | Request a quote |
| `/about` | About NestSelf: mission, how professionals are vetted, team as roles | all | Contact |
| `/contact` | Contact and demo request form | employers | Send |
| `/privacy-model` | How confidentiality works (existing, expanded) | all | For employees |
| `/accessibility` | Accessibility statement | all | Contact |
| `/legal/privacy-policy`, `/legal/terms`, `/legal/cookies`, `/legal/imprint` | Legal pages (EU, Serbia, Hungary impresszum) | all | none |
| `/credits` | Photo and font credits (existing, extended with generated imagery) | all | none |

Navigation: Services (dropdown-free: a single link to the overview, with the three services listed on it), For employers, For employees, Resources, Plans, About, with a locale switcher and the "Request a demo" button in the header actions slot. Footer: four columns (Product, Resources, Company, Legal) plus locale switcher, tagline and credits.

## 4. Architecture

### 4.1 Locales

`hu` is added to `packages/i18n` (`locales`, `localeMeta` with `htmlLang: 'hu'`, `hreflang: 'hu'`, `intl: 'hu-HU'`, `nativeName: 'Magyar'`), to `packages/contracts` `LocaleSchema`, to the fallback map (`hu` falls back to `en`), to the parity checker (Hungarian plural groups are `_one` and `_other`), to the e2e `PageEntry.locale` union and `snap.mjs`, and to every catalog namespace. Catalogs for workspace, admin, mobile and common are translated once (drafts pending native review, like the Serbian ones). Onest covers every Hungarian and Serbian glyph (verified from the TTF cmap: ő ű and all Cyrillic letters present).

The marketing header gets a `LocaleSwitcher` (links to the same path in each locale; sets the `NEXT_LOCALE` cookie the proxy already honours). `generateStaticParams`, `sitemap.ts` and `localeAlternates` pick the new locale up from the shared `locales` array.

### 4.2 Two kinds of text

- UI strings (navigation, buttons, form labels, errors, shared microcopy) stay in i18next catalogs: `packages/i18n/locales/<locale>/marketing.json` and `common.json`.
- Page content (headlines, paragraphs, feature lists, FAQ items, steps) lives in typed content files inside the app, not in i18next. Long-form marketing content with arrays and nested structure is awkward in i18next and a single shared JSON file would be a merge bottleneck for parallel work.

Page content format: `apps/marketing/content/pages/<page>/<locale>.json`, validated by a zod schema per page in `apps/marketing/src/content/schemas/<page>.ts`. Loader: `loadPageContent(page, locale)` reads the file, validates it, and falls back to `en` for a missing locale with a logged warning in development and a build failure in CI (`CONTENT_STRICT=1`). Server components receive the typed object and pass slices to section components as props. Section components are presentational and contain no copy.

### 4.3 Resource content (MDX)

- Articles and webinars: `apps/marketing/content/<articles|webinars>/<slug>/<locale>.mdx` with zod-validated frontmatter. Rendering uses `next-mdx-remote/rsc` with `remark-gfm` and `rehype-slug`, and a small component map (headings, callouts, figures via `PhotoFigure`).
- Article frontmatter: `title`, `description`, `topic` (one of psychological, legal, financial, work, family, managers), `publishedAt`, `updatedAt?`, `readingMinutes` (computed when absent), `cover` (photo key), `author` (always a role such as "NestSelf editorial team"; never a named invented expert), `reviewedBy?` (omitted until a real reviewer exists), `related` (slugs).
- Webinar frontmatter: `title`, `description`, `topic`, `startsAt` (ISO with offset), `durationMinutes`, `format` (`live` or `on-demand`), `speaker` (role and area, no invented personal names), `language` (locale codes the webinar is held in), `cover`, `registrationOpen`.
- Self-assessments: data, not prose: `apps/marketing/content/assessments/<slug>/<locale>.json` with `title`, `intro`, `instrument` (source and licence line), `questions[]` (text), `options[]` (label, score), `scoring` (bands with range, title, body, next step), `disclaimer`, `crisis` block. Only instruments that are free for commercial web use are included (the research guide section 4 lists them); the WHO-5 is the first, a Copenhagen Burnout Inventory personal-burnout check the second, and two NestSelf-authored, explicitly non-clinical check-ins (workplace stress, financial wellbeing) complete the set.
- Other tools: MDX guides under `apps/marketing/content/tools/<slug>/<locale>.mdx` (conversation planner, budget planner worksheet, legal document checklist).
- `sr-Cyrl` files for all content types are generated from `sr-Latn` by `apps/marketing/scripts/transliterate-content.mjs`, which reuses `packages/i18n/scripts/transliterate-core.mjs` and protects code spans, URLs, frontmatter keys and brand names. `apps/marketing/scripts/check-content.mjs` enforces: every slug has `en`, `sr-Latn`, `hu`; `sr-Cyrl` matches a fresh transliteration; frontmatter validates; every referenced photo key and related slug exists. It is wired into `pnpm check`.

### 4.4 Components

New in `packages/ui` (generic, tested, with stories): `Accordion` (Base UI Accordion, used for FAQ), `Card` (surface, border, radius and padding presets), `Textarea` (if `Field` does not already provide one), `ProgressBar` (assessment progress, `role="progressbar"`), `Breadcrumbs`. Everything else is marketing-specific and lives in `apps/marketing/src/components/`: `sections/` (hero, split, feature grid, steps, faq, testimonials, cta band, plans, logo-free trust strip), `cards/` (webinar, article, tool), `assessment/` (runner, result), `forms/` (demo request, webinar registration), `chrome/` (header with locale switcher, footer, breadcrumbs wrapper).

Density and imagery follow the handoff: generous photography on public pages, task-focused forms. All colours through semantic tokens; the smoke test still scans `apps/*/src`.

### 4.5 Assessment runner

A client component driven by the assessment JSON: one question per step, Base UI radio groups, visible progress, keyboard completion, result computed locally with the scoring bands, nothing sent anywhere (the page says so). Every result shows the disclaimer ("not a diagnosis") and the crisis block, and offers two next steps: talk to a professional (workspace link for employees) and read related articles. Unit tests cover scoring edge cases per instrument.

### 4.6 Lead capture

- Shared schemas in `packages/contracts/src/leads.ts`: `DemoRequestSchema` (name, work email, company, company size bucket, country `RS | HU | OTHER`, role, message, consent, locale, honeypot), `ContactMessageSchema`, `WebinarRegistrationSchema` (webinar slug, name, email, consent, locale).
- API: `LeadsModule` in `apps/api` with public, throttled routes `POST /api/leads/demo-requests`, `POST /api/leads/contact`, `POST /api/leads/webinar-registrations`, validated with the shared zod schemas, stored in a `Lead` table (Prisma model with `kind`, `payload` JSON, `email`, `locale`, `source`, `createdAt`) via a new migration. No email is sent yet; a comment marks where a BullMQ job will be enqueued.
- Marketing: Next route handlers `POST /api/leads/*` validate again and forward to `${API_URL}` (server-side env, never public). When `API_URL` is unset, they return 503 and the form shows an honest failure with the contact email address. Forms use `Field`, `FormErrorSummary` and `LiveRegion`; success states say exactly what happened ("We received your request") and never promise response times.

### 4.7 Imagery

Generated with the `openai-image-gen` skill (`gpt-image-2.5-sunburst`), drafted at `low` quality and finalised at `high` for heroes and `medium` for cards. Masters: 2048x1360 for 3:2 heroes, 1536x1024 for 3:2 cards, 1024x1280 for 4:5 portraits, 1536x800 for the Open Graph image. Files go to `packages/assets/photos/` with entries in `photos.json` carrying `kind: "generated"`, a generator credit, a focal point chosen after viewing, and the standing usage note (no endorsement, no eligibility implied). `PhotoKey` becomes a maintained list in `photo-keys.ts` with a test asserting parity with `photos.json`. The credits builder gains a "Generated imagery" section. The imagery list and prompt directions are in the research guide section 7.

Faces are never used as named experts or customers; testimonials use initials.

### 4.8 SEO

Per-page `generateMetadata` with localised title and description; hreflang alternates for all four locales plus `x-default`; `sitemap.ts` enumerates static routes and every content slug per locale; `robots.ts` unchanged. JSON-LD: `Organization` and `WebSite` on every page, `Article` on articles, `Event` with `OnlineEventAttendanceMode` on webinars, `FAQPage` where an FAQ section renders, `BreadcrumbList` on nested pages. A generated Open Graph image per locale under `public/og/`.

### 4.9 Docker

- `apps/api/Dockerfile`: multi-stage on `node:24-alpine` with corepack pnpm 10.10.0: fetch with the lockfile, install the API filter, `prisma generate`, `nest build`, `pnpm deploy --prod` into a runtime stage running as a non-root user with a healthcheck on `/api/health`. An entrypoint runs `prisma migrate deploy` when `RUN_MIGRATIONS=true`.
- `.dockerignore` at the repo root.
- `docker/docker-compose.yml`: `postgres` (17-alpine, volume, healthcheck), `redis` (7-alpine, volume, healthcheck, reserved for BullMQ), `api` (built from the repo root, waits for healthy Postgres, env from `docker/.env.example`, port 4000). `REDIS_URL` is added to the API env schema as optional so the queue phase needs no config change.
- Docker Desktop is not running on this machine, so the image is reviewed but not built here; the build is a launch-checklist item and a CI job.

## 5. Content and honesty rules for this site

- Testimonials are placeholders: `SAMPLE_TESTIMONIALS` in `packages/sample-data` with `placeholder: true`, fictional first names and roles, anonymised company descriptors, quotes written per locale. Rendered with initials, `data-placeholder="true"`, and listed in the launch checklist to be replaced. `CLAUDE.md` is updated to say exactly this.
- No invented statistics, outcome claims, client logos, availability promises ("24/7") or response-time promises. Facts we can state: three support areas, four locales, licensed professionals, anonymised HR reporting with minimum group sizes, GDPR.
- Family coverage is always "where included in your employer's plan".
- Assessments are not diagnoses; every result carries the disclaimer and the crisis block with local emergency numbers (Serbia 112 and 194, Hungary 112 and 104) and a national helpline line only where the research confirmed one.
- Expert portraits: roles and initials only.
- Pricing: no numbers; plan tiers describe scope and are quote based.

## 6. Verification

- Vitest: content loader and schema tests, assessment scoring, lead schemas, route handlers (fetch mocked), new UI components (keyboard, roles, axe), API leads controller and service.
- `pnpm check`: token smoke (now also scanning the new marketing code), locale parity with four locales, content parity and transliteration.
- Playwright: every route registered in `e2e/pages/marketing/*.ts` for `en`, plus `hu` and `sr-Cyrl` variants of home, employers, one service, one article, one webinar and one tool, plus the dark home. Screenshots at 390 and 1440, axe, 320 reflow. New keyboard tests: assessment completable by keyboard; demo form shows the error summary and focuses it on empty submit; locale switcher changes `lang` and the URL.
- Visual review loop: after implementation, regenerate baselines and review every PNG at both widths (the orchestrator and a review agent), fix layout, text overflow, Hungarian long-word wrapping and image focal problems, regenerate.
- Browser check of a dialog focus trap and the assessment at 390 px in a real browser.

## 7. Decisions taken in this design

1. Typed page-content files for marketing copy, i18next only for UI strings (section 4.2).
2. MDX via `next-mdx-remote` 6 rather than a CMS or `@next/mdx`: content stays in the repo, works with the webpack build, and needs no bundler plugin.
3. Hungarian added to every namespace, not just marketing, so the locale list stays global; non-marketing Hungarian catalogs are drafts.
4. English slugs in all locales; localised slugs deferred.
5. One `Lead` table with a `kind` column instead of three tables.
6. Redis in Compose now, BullMQ code later.
7. Postgres 17 in Compose to match the local verification database.
8. No cookie banner: only the functional `NEXT_LOCALE` cookie is set; the cookie policy page explains it.
9. Testimonials mocked as requested, flagged in code and in the launch checklist.

## 8. Launch checklist (not done in this pass)

Replace placeholder testimonials with real, consented quotes; native-speaker review of Serbian and Hungarian; build and push the API image in CI; email notifications for leads (BullMQ worker); localised slugs; legal review of the privacy policy, terms, cookie policy and impresszum texts (they are drafted templates with the company identifiers left as clearly marked fields); real expert profiles; Android.

## 9. Work breakdown

Phase A (parallel, disjoint directories): A1 Hungarian locale plumbing and catalogs; A2 content layer, schemas, loaders, transliteration and parity scripts; A3 UI additions; A4 contracts and API leads module with migration; A5 Docker; A6 imagery generation and asset registration.

Phase B (parallel by page group, after A): B1 chrome, layout, home; B2 employers, employees, managers, plans, about; B3 services overview and three service pages; B4 webinars and articles with English content; B5 tools and assessments with English content; B6 contact, legal, accessibility, credits, route handlers.

Phase C (integration): C1 SEO and sitemap; C2 translation of all new content and strings to `sr-Latn` and `hu`, Cyrillic generated; C3 e2e registration, baselines, visual review loop, a11y fixes; C4 full verification, commit, report.
