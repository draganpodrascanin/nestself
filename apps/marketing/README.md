# @nestself/marketing

Public marketing site built with Next.js 16 (App Router, webpack). Locales: `en`, `sr-Latn`, `sr-Cyrl` (generated), `hu`.

## Routes

All routes live under `/[locale]`. English slugs are used in every locale; hreflang alternates and a sitemap cover the four locales.

| Path                                                                                             | Page                                               |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------- |
| `/`                                                                                              | Home                                               |
| `/for-employers`, `/for-employees`, `/for-managers`                                              | Audience pages (`/employers` redirects)            |
| `/services`, `/services/therapy`, `/services/legal-consultation`, `/services/financial-guidance` | Services (`/support` redirects)                    |
| `/resources`, `/articles`, `/articles/[slug]`, `/webinars`, `/webinars/[slug]`                   | Resources                                          |
| `/tools`, `/tools/[slug]`                                                                        | Wellbeing check-ins (assessment runner) and guides |
| `/plans`, `/about`, `/faq`                                                                       | Plans, about, FAQ                                  |
| `/demo`, `/contact`                                                                              | Demo request and contact forms                     |
| `/privacy-model`, `/accessibility`                                                               | Trust pages                                        |
| `/legal/privacy-policy`, `/legal/terms`, `/legal/cookies`, `/legal/imprint`                      | Legal pages (drafts with bracketed placeholders)   |
| `/robots.txt`, `/sitemap.xml`, `/[locale]/opengraph-image`                                       | SEO                                                |

## Where the text lives

- UI strings: `packages/i18n/locales/<locale>/marketing.json` and `common.json` (i18next).
- Page copy: `content/pages/<page>/<locale>.json`, validated by the zod schema in `src/app/[locale]/<route>/content.ts`.
- Articles, webinars, guides: `content/{articles,webinars,tools}/<slug>/<locale>.mdx`; check-ins: `content/assessments/<slug>/<locale>.json`. See `content/README.md`.
- `sr-Cyrl` files are generated from `sr-Latn`: `pnpm --filter @nestself/marketing content:cyrillic`. `pnpm --filter @nestself/marketing check` validates every file, cover key and translation parity.

## Lead capture

The demo, contact and webinar-registration forms post to `/api/leads/<kind>` route handlers, which validate with the shared zod schemas from `@nestself/contracts` and forward to the NestJS API at `API_URL`. Without `API_URL` the handlers return 503 and the forms show an honest failure with the contact email. Nothing is stored by this app.

## Environment

| Variable                    | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SITE_URL`      | Canonical origin for metadata, sitemap and Open Graph                    |
| `NEXT_PUBLIC_WORKSPACE_URL` | "Open the workspace" links                                               |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Contact address shown on the site (defaults to a `.example` placeholder) |
| `API_URL`                   | Server-side base URL of the API for lead forwarding                      |

## Locale behaviour

Serbian Latin, the default, lives at the root (`/`, `/plans`); every other locale is prefixed (`/en/plans`, `/hu`, `/sr-Cyrl/plans`). `src/proxy.ts` rewrites unprefixed requests to the `[locale]` tree internally, redirects `/sr-Latn/...` permanently to the unprefixed path, and sends visitors who chose another language earlier (the `NEXT_LOCALE` cookie the switcher writes) to that language. The browser's `Accept-Language` is not consulted: the site is Serbian first and other languages are an explicit choice. Build links with `localePath(locale, '/path')` from `@nestself/i18n`, never by hand. English is the authoring source of content files.

## Images

Generated and stock photographs live in `packages/assets`; run `pnpm --filter @nestself/marketing images:sync` to copy the processed variants into `public/images`.

## Policies

No analytics and no cookie banner (only the functional `NEXT_LOCALE` cookie). No invented statistics, outcome claims or client logos. Testimonials are placeholders from `SAMPLE_TESTIMONIALS` until real ones exist. Check-ins run in the browser and store nothing.
