# @nestself/tokens

Framework-independent design tokens for NestSelf. All palette values live **only** in `tokens.css` / `tokens.json` -- component and app code references semantic variables.

## Files

| File | Purpose |
|---|---|
| `tokens.json` | Source of truth: palettes, primitives, typography, layout, components |
| `tokens.css` | CSS custom properties: 4 palettes x 2 modes, primitives, fonts, motion |
| `tailwind.css` | Tailwind v4 `@theme inline` bridge -- import after `tokens.css` |
| `contrast-report.json` | WCAG contrast ratios for all foreground/background pairs |
| `src/index.ts` | Typed TS access to tokens, palettes, type guards |
| `src/theme.ts` | Framework-free theme runtime: apply, read, persist, boot script |
| `src/native.ts` | React Native tokens: colors (camelCase), space (dp), type scales (pt/sp) |

## Token mapping table

| Handoff token | CSS variable | Tailwind utility | Native key |
|---|---|---|---|
| canvas | `--color-canvas` | `bg-canvas` | `canvas` |
| surface | `--color-surface` | `bg-surface` | `surface` |
| raised | `--color-raised` | `bg-raised` | `raised` |
| tint | `--color-tint` | `bg-tint` | `tint` |
| text | `--color-text` | `text-text` | `text` |
| text-secondary | `--color-text-secondary` | `text-text-secondary` | `textSecondary` |
| border-subtle | `--color-border-subtle` | `border-border-subtle` | `borderSubtle` |
| border-control | `--color-border-control` | `border-border-control` | `borderControl` |
| primary | `--color-primary` | `bg-primary` | `primary` |
| primary-hover | `--color-primary-hover` | `bg-primary-hover` | `primaryHover` |
| primary-pressed | `--color-primary-pressed` | `bg-primary-pressed` | `primaryPressed` |
| on-primary | `--color-on-primary` | `text-on-primary` | `onPrimary` |
| accent | `--color-accent` | `bg-accent` | `accent` |
| on-accent | `--color-on-accent` | `text-on-accent` | `onAccent` |
| accent-soft | `--color-accent-soft` | `bg-accent-soft` | `accentSoft` |
| focus | `--color-focus` | `ring-focus` | `focus` |
| disabled-surface | `--color-disabled-surface` | `bg-disabled-surface` | `disabledSurface` |
| disabled-text | `--color-disabled-text` | `text-disabled-text` | `disabledText` |
| scrim | `--color-scrim` | `bg-scrim` | `scrim` |
| success | `--color-success` | `text-success` | `success` |
| success-surface | `--color-success-surface` | `bg-success-surface` | `successSurface` |
| warning | `--color-warning` | `text-warning` | `warning` |
| warning-surface | `--color-warning-surface` | `bg-warning-surface` | `warningSurface` |
| danger | `--color-danger` | `text-danger` | `danger` |
| danger-surface | `--color-danger-surface` | `bg-danger-surface` | `dangerSurface` |
| info | `--color-info` | `text-info` | `info` |
| info-surface | `--color-info-surface` | `bg-info-surface` | `infoSurface` |

## Primitives

| Category | CSS variable pattern | Tailwind | Native |
|---|---|---|---|
| Radius | `--radius-{small,control,card,modal,sheet,pill}` | `rounded-{name}` | `nativeRadius.{name}` |
| Shadow | `--shadow-{low,menu,modal}` | `shadow-{name}` | n/a (platform shadows) |
| Space | `--space-{0..96}` | Default numeric scale | `nativeSpace.{n}` (dp) |
| Motion | `--motion-{fast,standard,slow}` | `duration-[var(--motion-fast)]` | `nativeMotion.{name}Ms` |
| Z-index | `--z-{base..tooltip}` | `z-[var(--z-dialog)]` | n/a |
| Font | `--font-{body,heading,code}` | `font-{body,heading,code}` | `nativeFontFiles` |

## Rule

Palette values live only in `tokens.css` / `tokens.json`. Components and apps use semantic CSS variables or the typed exports. The smoke test enforces this by scanning for hex colour literals in component and app source.
