# @nestself/i18n

Shared internationalisation setup for the NestSelf monorepo. Provides locale configuration, translation catalogs, format helpers and transliteration tooling used by all four apps (marketing, workspace, admin, mobile).

## Locales

| Code | Name | Script |
|------|------|--------|
| `en` | English | Latin |
| `sr-Latn` | Srpski (latinica) | Latin |
| `sr-Cyrl` | Српски (ћирилица) | Cyrillic |

## Namespaces

- **common** — shared UI labels, state messages, roles, form validation
- **marketing** — public homepage and landing page copy
- **workspace** — employee/manager SPA strings
- **admin** — back-office administration strings
- **mobile** — native mobile app strings

## Serbian translations

The Serbian Latin (`sr-Latn`) catalogs are **drafts** written for this initial setup. They should be reviewed by a native Serbian speaker before launch. The Cyrillic (`sr-Cyrl`) catalogs are generated automatically from the Latin source via the transliteration script.

## Scripts

- `pnpm --filter @nestself/i18n build:cyrillic` — generates `sr-Cyrl` JSON files from `sr-Latn` using deterministic transliteration
- `pnpm --filter @nestself/i18n check` — validates locale parity (key completeness, empty strings, plural groups, placeholder consistency, Cyrillic freshness)
- `pnpm --filter @nestself/i18n test` — runs unit tests
- `pnpm --filter @nestself/i18n typecheck` — TypeScript type checking
- `pnpm --filter @nestself/i18n lint` — ESLint

## Usage

```ts
import {
  i18nBaseOptions,
  resources,
  resourcesFor,
  formatCurrency,
  formatDate,
  negotiateLocale,
  parseAcceptLanguage,
} from '@nestself/i18n';
```

## Transliteration

The transliteration handles Serbian-specific digraphs (dž, lj, nj), preserves `{{placeholders}}`, HTML-like tags, URLs, and protected brand names (NestSelf, Pexels, Phosphor, Onest). Word-level overrides are maintained in `scripts/transliteration-exceptions.json`.
