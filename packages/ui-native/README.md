# @nestself/ui-native

React Native primitives for the NestSelf design system. Built on `@nestself/tokens/native` semantic tokens with zero hex colour literals in component code.

## Theme

Wrap your app in `<ThemeProvider>` to activate the theme. The provider holds `{ palette, mode }` and exposes it via `useTheme()`.

```tsx
import { ThemeProvider } from '@nestself/ui-native';

export default function App() {
  return (
    <ThemeProvider initial={{ palette: 'forest', mode: 'light' }}>
      {/* app content */}
    </ThemeProvider>
  );
}
```

### useTheme()

Returns the full theme state:

- `colors` -- `NativeColors` keyed in camelCase (e.g. `textSecondary`, `primaryPressed`, `borderControl`).
- `mode`, `palette` -- current selection.
- `setMode(mode)`, `setPalette(palette)` -- update the theme.
- `space` -- the `nativeSpace` scale (0, 2, 4, 8 ... 96).
- `radius` -- the `nativeRadius` scale (small, control, card, modal, sheet, pill).
- `type` -- platform-resolved type scale (`Record<TypeRole, TypeStyleResult>`), using `Platform.OS` to pick the ios or android sizes.

### useReducedMotion()

Tracks the device Reduce Motion setting via `AccessibilityInfo`. Returns `true` when the user has enabled Reduce Motion.

## Typography

The type system uses `Onest-Regular` (weight 400), `Onest-SemiBold` (weight 600), and `Onest-Bold` (weight 700). **No italic** -- `fontStyle: 'italic'` is never set.

### Font loading contract

The app must load the three Onest TTF files via `expo-font` before rendering. Example:

```tsx
import { useFonts } from 'expo-font';

const [loaded] = useFonts({
  'Onest-Regular': require('@nestself/assets/fonts/Onest-Regular.ttf'),
  'Onest-SemiBold': require('@nestself/assets/fonts/Onest-SemiBold.ttf'),
  'Onest-Bold': require('@nestself/assets/fonts/Onest-Bold.ttf'),
});
```

This package only references those family names; it does not load the font files itself.

### Font scaling

All `Text` components default to `allowFontScaling={true}` and `maxFontSizeMultiplier={2}`. No fixed heights are applied to containers so they grow naturally with larger text.

## How the theme maps to tokens

`@nestself/tokens/native` provides:

- `nativeThemes[palette][mode]` -- the `NativeColors` object with camelCase keys matching the CSS custom property names (e.g. `--color-text-secondary` becomes `textSecondary`).
- `nativeSpace` -- numeric spacing scale.
- `nativeRadius` -- named radius scale.
- `nativeType[platform]` -- the type scale per platform (ios/android), with fontSize, lineHeight, fontWeight, and letterSpacing for each role.

The `ThemeProvider` resolves `Platform.OS` once to select the ios or android type scale and passes the resolved `TypeStyleResult` map through context.

## Upgrade path

- **Uniwind 1.13** -- provides Tailwind v4 utility-class support on React Native, enabling the same `tailwind.css` bridge from the web. This is the evaluated next step.
- **NativeWind 4** -- only supports Tailwind v3 and does not match the monorepo's Tailwind v4 setup. Not recommended.

## Components

All components live in `src/components/` with clean props interfaces. See `src/index.ts` for the full export list.

| Component | Description |
|---|---|
| Screen | Safe-area padded container with canvas background |
| Text | Themed text with type-role and tone props |
| Button | Pressable button (primary/secondary/ghost/danger) |
| Field + Input | Form field wrapper with label, helper, error |
| Card | Surface container with card radius |
| ListRow | Touch-friendly list row (minHeight 64) |
| Badge | Pill-shaped status indicator |
| Alert | Semantic alert banner |
| StatusBlock | Centred empty/status pattern |
| Avatar | Circular initials avatar |
| Icon | Phosphor icon wrapper |
| CategoryIcon | Category-mapped duotone icon |
| CostBreakdown | Three-row cost table with tabular-nums |
| Divider | Horizontal rule |
