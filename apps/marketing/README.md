# @nestself/marketing

Public-facing marketing site built with Next.js 16 (App Router).

## Routes

| Path                      | Description              |
| ------------------------- | ------------------------ |
| `/[locale]`               | Homepage                 |
| `/[locale]/support`       | Support areas            |
| `/[locale]/employers`     | Employer experience      |
| `/[locale]/privacy-model` | Access matrix            |
| `/[locale]/credits`       | Photography, fonts, icons|
| `/robots.txt`             | Robots directive         |
| `/sitemap.xml`            | Sitemap with alternates  |

## Locale behaviour

Requests without a locale prefix are redirected via `proxy.ts` (Next 16 middleware).
The locale is negotiated from the `NEXT_LOCALE` cookie, then the `Accept-Language`
header, falling back to `en`. Supported locales: `en`, `sr-Latn`, `sr-Cyrl`, `hu`.

## Image sync

Run `pnpm --filter @nestself/marketing images:sync` to copy processed image
variants from `packages/assets/dist/images` into `public/images`.

## No-analytics policy

This site includes no analytics, cookie banners, newsletter forms, testimonials,
client logos or statistics. Interactive demonstrations state that nothing was created.
