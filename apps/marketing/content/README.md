# Marketing content

This directory holds all marketing content: articles, webinars, tools, assessments and page-level content. Content is managed as flat files, not through a CMS.

## Directory layout

```
content/
  articles/<slug>/
    en.mdx
    sr-Latn.mdx
    sr-Cyrl.mdx   (generated)
    hu.mdx
  webinars/<slug>/
    en.mdx
    sr-Latn.mdx
    sr-Cyrl.mdx   (generated)
    hu.mdx
  tools/<slug>/
    en.mdx
    sr-Latn.mdx
    sr-Cyrl.mdx   (generated)
    hu.mdx
  assessments/<slug>/
    en.json
    sr-Latn.json
    sr-Cyrl.json  (generated)
    hu.json
  pages/<page>/
    en.json
    sr-Latn.json
    sr-Cyrl.json  (generated)
    hu.json
```

Every slug directory must contain at least an `en` file. Serbian Cyrillic (`sr-Cyrl`) files are generated from the Latin (`sr-Latn`) source by transliteration and must never be edited by hand.

## Frontmatter fields

### Articles (`articles/<slug>/<locale>.mdx`)

| Field         | Type       | Required | Default                    |
| ------------- | ---------- | -------- | -------------------------- |
| `title`       | string     | yes      |                            |
| `description` | string     | yes      | (max 200 chars)            |
| `topic`       | enum       | yes      | psychological, legal, financial, work, family, managers |
| `publishedAt` | YYYY-MM-DD | yes      |                            |
| `updatedAt`   | YYYY-MM-DD | no       |                            |
| `cover`       | string     | yes      | key from photos.json       |
| `coverAlt`    | string     | yes      |                            |
| `author`      | string     | no       | NestSelf editorial team    |
| `related`     | string[]   | no       | [] (slugs of related articles) |
| `draft`       | boolean    | no       | false                      |

### Webinars (`webinars/<slug>/<locale>.mdx`)

| Field                | Type             | Required | Default |
| -------------------- | ---------------- | -------- | ------- |
| `title`              | string           | yes      |         |
| `description`        | string           | yes      |         |
| `topic`              | enum             | yes      |         |
| `startsAt`           | ISO 8601 datetime| yes      |         |
| `durationMinutes`    | integer          | yes      |         |
| `format`             | live \| on-demand| yes      |         |
| `speaker.role`       | string           | yes      |         |
| `speaker.area`       | topic enum       | yes      |         |
| `languages`          | (en\|sr\|hu)[]   | yes      |         |
| `cover`              | string           | yes      |         |
| `coverAlt`           | string           | yes      |         |
| `registrationOpen`   | boolean          | no       | true    |
| `recordingAvailable` | boolean          | no       | false   |
| `draft`              | boolean          | no       | false   |

### Tools (`tools/<slug>/<locale>.mdx`)

| Field         | Type                       | Required | Default |
| ------------- | -------------------------- | -------- | ------- |
| `title`       | string                     | yes      |         |
| `description` | string                     | yes      |         |
| `topic`       | enum                       | yes      |         |
| `kind`        | guide \| planner \| checklist | yes   |         |
| `cover`       | string                     | yes      |         |
| `coverAlt`    | string                     | yes      |         |
| `order`       | integer                    | no       | 100     |
| `draft`       | boolean                    | no       | false   |

### Assessments (`assessments/<slug>/<locale>.json`)

Assessments are JSON files with the following structure:

- `title` (string)
- `intro` (string)
- `durationMinutes` (integer)
- `topic` (enum)
- `instrument` - `{ name, source (URL), licence }`
- `questions` - array of `{ id, text }`
- `options` - array of `{ label, score }` (min 2)
- `scoring` - `{ min, max, bands: [{ min, max, title, body, nextStep }] }`
- `disclaimer` (string) - always required
- `crisis` - `{ title, body, lines: [{ label, value }] }`

Assessments are never diagnoses. Every assessment must include a disclaimer and a crisis block.

### Pages (`pages/<page>/<locale>.json`)

Page content files are free-form JSON validated against a page-specific schema at load time.

## How to add an article

1. Create a directory under `content/articles/` with a URL-friendly slug.
2. Create `en.mdx` with YAML frontmatter matching the schema above.
3. Create `sr-Latn.mdx` with the Serbian Latin translation.
4. Create `hu.mdx` with the Hungarian translation.
5. Regenerate Cyrillic:
   ```sh
   pnpm --filter @nestself/marketing content:cyrillic
   ```
6. Run the content check:
   ```sh
   pnpm --filter @nestself/marketing check
   ```

## Regenerating Cyrillic

Serbian Cyrillic files are auto-generated from the `sr-Latn` source:

```sh
pnpm --filter @nestself/marketing content:cyrillic
```

This transliterates frontmatter string values (`title`, `description`, `coverAlt`, `author`, `speaker.role`) and the body text, while protecting code blocks, inline code, URLs, HTML/JSX tags and import/export lines.

## What `check` validates

The `pnpm --filter @nestself/marketing check` script:

- Verifies `en` exists for every slug/page
- Checks `sr-Latn` and `hu` exist (configurable with `CONTENT_ALLOW_MISSING_LOCALES=1`)
- Confirms `sr-Cyrl` matches a fresh transliteration of `sr-Latn`
- Validates every file against its schema
- Checks `cover` keys exist in `@nestself/assets` `photos.json`
- Checks every `related` slug references an existing article

## Content rules

- No invented statistics, outcome claims, client logos or availability promises
- Family coverage is always "where included in your employer's plan"
- Self-assessments are never diagnoses; always show the disclaimer and crisis block
- Expert portraits use roles and initials, never generated faces with names
- Testimonials come only from `SAMPLE_TESTIMONIALS` in `@nestself/sample-data` (placeholder-flagged)
- Pricing shows no numbers
