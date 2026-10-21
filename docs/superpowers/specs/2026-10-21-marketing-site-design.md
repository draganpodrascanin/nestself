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

| Audience                                                         | What they need from the site                                                                                   | Primary CTA                                                     |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Employers: HR, people leaders, founders in Serbia and Hungary    | Understand the programme, trust it (confidentiality, professionals, GDPR), see how it launches, request a demo | Request a demo                                                  |
| Employees of client companies (and family members where covered) | Understand what they can use, how confidential it is, and start using it                                       | Open the workspace, or "Check if your employer offers NestSelf" |
| Managers                                                         | Resources for leading teams well, team polls and channels                                                      | Explore manager resources                                       |

Offering names follow the research guide section 2 (EN / SR Latin / HU): Therapy & Counselling (Psihoterapija i savetovanje / Pszichoterápia és tanácsadás), Legal Consultation (Pravno savetovanje / Jogi tanácsadás), Financial Guidance (Finansijsko savetovanje / Pénzügyi tanácsadás), Webinars (Vebinari / Webináriumok), Articles in a Resources hub (Resursi / Tudástár), Wellbeing check-ins (Provera blagostanja / Közérzeti pulzus), Self-help tools (Alati za samopomoć / Önsegítő eszközök), Workforce insights (Uvidi za HR / HR betekintések), Manager support (Podrška za rukovodioce / Vezetői támogatás), Family support (Podrška za porodicu / Családi támogatás). The taxonomy:

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

| Route                                                                       | Page                                                                 | Audience  | Primary CTA                    |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- | --------- | ------------------------------ |
| `/`                                                                         | Home                                                                 | all       | Request a demo; For employees  |
| `/for-employers`                                                            | For employers (`/employers` redirects)                               | employers | Request a demo                 |
| `/for-employees`                                                            | For employees                                                        | employees | Open the workspace             |
| `/services`                                                                 | Services overview (replaces `/support`, which redirects)             | all       | Request a demo                 |
| `/services/therapy`                                                         | Therapy and counselling                                              | all       | Request a demo / For employees |
| `/services/legal-consultation`                                              | Legal consultation                                                   | all       | same                           |
| `/services/financial-guidance`                                              | Financial guidance                                                   | all       | same                           |
| `/resources`                                                                | Resources hub (webinars, articles, tools)                            | all       | Browse                         |
| `/webinars`, `/webinars/[slug]`                                             | Webinar list and detail with registration                            | all       | Register                       |
| `/articles`, `/articles/[slug]`                                             | Article list and detail                                              | all       | Read; related CTA              |
| `/tools`, `/tools/[slug]`                                                   | Self-assessments and other tools; interactive runner for assessments | all       | Start                          |
| `/for-managers`                                                             | For managers                                                         | managers  | Explore                        |
| `/faq`                                                                      | FAQ for employers and employees                                      | all       | Request a demo                 |
| `/plans`                                                                    | Plans and pricing approach (quote based, no invented numbers)        | employers | Request a quote                |
| `/about`                                                                    | About NestSelf: mission, how professionals are vetted, team as roles | all       | Contact                        |
| `/demo`                                                                     | Demo request form (every "Request a demo" CTA lands here)            | employers | Send                           |
| `/contact`                                                                  | Contact form and details                                             | all       | Send                           |
| `/privacy-model`                                                            | How confidentiality works (existing, expanded)                       | all       | For employees                  |
| `/accessibility`                                                            | Accessibility statement                                              | all       | Contact                        |
| `/legal/privacy-policy`, `/legal/terms`, `/legal/cookies`, `/legal/imprint` | Legal pages (EU, Serbia, Hungary impresszum)                         | all       | none                           |
| `/credits`                                                                  | Removed on 2026-10-21 (decision 12): neither the Pexels licence nor the generated imagery needs attribution; provenance stays in `photos.json` | —         | —                              |

Navigation: Services (a single link to the overview, with the three services listed on it), For employers, For employees, Resources, Plans, About, with the "Request a demo" button (to `/demo`) in the header actions slot and a language dropdown (globe icon, current language, menu of the four languages with the Serbian script named) in the header's utilities slot, visually subordinate to the navigation. Footer: four columns (Product, Resources, Company, Legal) plus the same language dropdown and the tagline.

## 4. Architecture

### 4.1 Locales

`hu` is added to `packages/i18n` (`locales`, `localeMeta` with `htmlLang: 'hu'`, `hreflang: 'hu'`, `intl: 'hu-HU'`, `nativeName: 'Magyar'`), to `packages/contracts` `LocaleSchema`, to the fallback map (`hu` falls back to `en`), to the parity checker (Hungarian plural groups are `_one` and `_other`), to the e2e `PageEntry.locale` union and `snap.mjs`, and to every catalog namespace. Catalogs for workspace, admin, mobile and common are translated once (drafts pending native review, like the Serbian ones). Onest covers every Hungarian and Serbian glyph (verified from the TTF cmap: ő ű and all Cyrillic letters present).

The marketing header gets a `LocaleSwitcher` (a Base UI menu of links to the same path in each locale; sets the `NEXT_LOCALE` cookie the proxy already honours). `generateStaticParams`, `sitemap.ts` and `localeAlternates` pick the locales up from the shared `locales` array. Since 2026-10-21 (decision 10) `defaultLocale` is `sr-Latn`: the proxy and the root page fall back to Serbian Latin when neither the cookie nor `Accept-Language` matches, `x-default` points at the Serbian Latin URL, and every page's canonical URL is its own locale URL. English remains the authoring source of content files; that is a workflow convention, not a user-facing default.

### 4.2 Two kinds of text

- UI strings (navigation, buttons, form labels, errors, shared microcopy) stay in i18next catalogs: `packages/i18n/locales/<locale>/marketing.json` and `common.json`.
- Page content (headlines, paragraphs, feature lists, FAQ items, steps) lives in typed content files inside the app, not in i18next. Long-form marketing content with arrays and nested structure is awkward in i18next and a single shared JSON file would be a merge bottleneck for parallel work.

Page content format: `apps/marketing/content/pages/<page>/<locale>.json`, validated by a zod schema per page in `apps/marketing/src/content/schemas/<page>.ts`. Loader: `loadPageContent(page, locale)` reads the file, validates it, and falls back to `en` for a missing locale with a logged warning in development and a build failure in CI (`CONTENT_STRICT=1`). Server components receive the typed object and pass slices to section components as props. Section components are presentational and contain no copy.

### 4.3 Resource content (MDX)

- Articles and webinars: `apps/marketing/content/<articles|webinars>/<slug>/<locale>.mdx` with zod-validated frontmatter. Rendering uses `next-mdx-remote/rsc` with `remark-gfm` and `rehype-slug`, and a small component map (headings, callouts, figures via `PhotoFigure`).
- Article frontmatter: `title`, `description`, `topic` (one of psychological, legal, financial, work, family, managers), `publishedAt`, `updatedAt?`, `readingMinutes` (computed when absent), `cover` (photo key), `author` (always a role such as "NestSelf editorial team"; never a named invented expert), `reviewedBy?` (omitted until a real reviewer exists), `related` (slugs).
- Webinar frontmatter: `title`, `description`, `topic`, `startsAt` (ISO with offset), `durationMinutes`, `format` (`live` or `on-demand`), `speaker` (role and area, no invented personal names), `language` (locale codes the webinar is held in), `cover`, `registrationOpen`.
- Self-assessments: data, not prose: `apps/marketing/content/assessments/<slug>/<locale>.json` with `title`, `intro`, `instrument` (source and licence line), `questions[]` (text), `options[]` (label, score), `scoring` (bands with range, title, body, next step), `disclaimer`, `crisis` block. Only instruments that are free for commercial web use are included (research guide section 4): the GAD-7 (public domain, attributed to Spitzer, Williams, Kroenke and colleagues) and the Copenhagen Burnout Inventory personal-burnout scale (free with attribution), plus three NestSelf-authored, explicitly non-clinical check-ins (general wellbeing, workplace stress, financial wellbeing). The WHO-5 is excluded because its licence is disputed and likely non-commercial since 2024; MBI, WEMWBS and PSS-10 are excluded because they need paid or unclear licences.
- Other tools: MDX guides under `apps/marketing/content/tools/<slug>/<locale>.mdx` (conversation planner, budget planner worksheet, legal document checklist).
- `sr-Cyrl` files for all content types are generated from `sr-Latn` by `apps/marketing/scripts/transliterate-content.mjs`, which reuses `packages/i18n/scripts/transliterate-core.mjs` and protects code spans, URLs, frontmatter keys and brand names. `apps/marketing/scripts/check-content.mjs` enforces: every slug has `en`, `sr-Latn`, `hu`; `sr-Cyrl` matches a fresh transliteration; frontmatter validates; every referenced photo key and related slug exists. It is wired into `pnpm check`.

### 4.4 Components

New in `packages/ui` (generic, tested, with stories): `Accordion` (Base UI Accordion, used for FAQ), `Card` (surface, border, radius and padding presets), `Textarea` (if `Field` does not already provide one), `ProgressBar` (assessment progress, `role="progressbar"`), `Breadcrumbs`. Everything else is marketing-specific and lives in `apps/marketing/src/components/`: `sections/` (hero, split, feature grid, steps, faq, testimonials, cta band, plans, logo-free trust strip), `cards/` (webinar, article, tool), `assessment/` (runner, result), `forms/` (demo request, webinar registration), `chrome/` (header with locale switcher, footer, breadcrumbs wrapper).

Density and imagery follow the handoff: generous photography on public pages, task-focused forms. All colours through semantic tokens; the smoke test still scans `apps/*/src`.

### 4.5 Assessment runner

A client component driven by the assessment JSON: one question per step, Base UI radio groups, visible progress, keyboard completion, result computed locally with the scoring bands, nothing sent anywhere (the page says so). Every result shows the disclaimer ("not a diagnosis") and the crisis block, and offers two next steps: talk to a professional (workspace link for employees) and read related articles. Unit tests cover scoring edge cases per instrument.

### 4.6 Lead capture

- Shared schemas in `packages/contracts/src/leads.ts`: `DemoRequestSchema` (full name, work email, company, company size bucket `1-50 | 51-200 | 201-500 | 501-1000 | 1000+`, country `RS | HU | OTHER`, job title as `role`, how they heard about us, message, consent, locale, honeypot), `ContactMessageSchema`, `WebinarRegistrationSchema` (webinar slug, name, email, consent, locale).
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
- Assessments are not diagnoses; every result carries the disclaimer and the crisis block with local emergency numbers (Serbia 112 and 194, Hungary 112 and 104) and the helplines the research surfaced (Serbia: Centar Srce 0800 300 303; Hungary: Lelki Elsősegély Telefonszolgálat 116 123), with number verification on the launch checklist.
- Expert portraits: roles and initials only.
- Pricing: no numbers; plan tiers describe scope and are quote based.

## 6. Verification

- Vitest: content loader and schema tests, assessment scoring, lead schemas, route handlers (fetch mocked), new UI components (keyboard, roles, axe), API leads controller and service.
- `pnpm check`: token smoke (now also scanning the new marketing code), locale parity with four locales, content parity and transliteration.
- Playwright: 56 marketing entries registered through `e2e/pages/marketing/*.ts` (every route in `en`, `hu` and `sr-Cyrl` variants of the main pages, `sr-Latn` and dark home, form error states and the check-in result state via prepare actions). Screenshots at 390 and 1440, axe (WCAG 2.2 AA tags), 320 reflow. Keyboard tests: check-in completable by keyboard with focus landing on the result heading; demo form empty submit focuses the error summary and shows friendly messages; locale switcher changes the URL and `html[lang]`.
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
10. (Feedback round 1, 2026-10-21) Serbian Latin is the default language: `defaultLocale = 'sr-Latn'`, locale order `sr-Latn, sr-Cyrl, hu, en`, self-referencing canonicals, `x-default` on Serbian Latin; e2e base entries are Serbian Latin with `-en`, `-hu`, `-sr-cyrl` variants.
11. (Round 1) The locale switcher is a dropdown menu (globe icon + current language name; items "Srpski · latinica", "Српски · ћирилица", "Magyar", "English") in a header utilities slot at the far right and in the footer, not among the navigation links.
12. (Round 1) The credits page, credits dialog, `CREDITS.md` and its build script are removed: the Pexels licence and the generated images need no attribution. Photographer and source metadata stay in `packages/assets/photos.json` for provenance.
13. (Round 1) Testimonials: card grid with one featured card (brand tint, larger quote), quote icon instead of typographic quotes, localised roles and company descriptors, a "Sample data" badge beside the heading.
14. (Round 1) Steps sections: two-column composition (sticky heading, optional lead and photo on the left; a numbered vertical timeline with filled primary markers on the right), single column on phones. The uppercase "01" eyebrow pattern is gone.
15. (Round 1) Reading pages (articles, webinars, guides, legal, accessibility) use one centred 720 px reading column for header, cover, body and disclaimer; related content stays container-wide below a rule. Every section shares `SECTION_PADDING` (`py-16`, `py-10` on phones); the trust strip is a bordered band directly under the hero with a two-column grid on phones.

## 8. Launch checklist (not done in this pass)

Translations were produced and reviewed by language-model translators and reviewers, not by native professionals: a native Serbian and a native Hungarian review remain mandatory before launch. Replace placeholder testimonials with real, consented quotes; verify the crisis helpline numbers and hours with the operators; set the real contact email; conduct a DPIA and obtain a medical-device (MDR) classification opinion for the check-ins before any answers are ever stored (today nothing is stored); validate the Serbian programme name and the Hungarian informal register with native HR professionals; legal review of the Serbian psychotherapist wording; native-speaker review of Serbian and Hungarian; build and push the API image in CI; email notifications for leads (BullMQ worker); localised slugs; legal review of the privacy policy, terms, cookie policy and impresszum texts (they are drafted templates with the company identifiers left as clearly marked fields); real expert profiles; Android.

## 9. Work breakdown

Phase A (parallel, disjoint directories): A1 Hungarian locale plumbing and catalogs; A2 content layer, schemas, loaders, transliteration and parity scripts; A3 UI additions; A4 contracts and API leads module with migration; A5 Docker; A6 imagery generation and asset registration.

Phase B (parallel by page group, after A): B1 chrome, layout, home; B2 employers, employees, managers, plans, about; B3 services overview and three service pages; B4 webinars and articles with English content; B5 tools and assessments with English content; B6 contact, legal, accessibility, credits, route handlers.

Phase C (integration): C1 SEO and sitemap; C2 translation of all new content and strings to `sr-Latn` and `hu`, Cyrillic generated; C3 e2e registration, baselines, visual review loop, a11y fixes; C4 full verification, commit, report.
