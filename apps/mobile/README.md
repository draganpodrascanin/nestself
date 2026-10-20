# NestSelf Mobile

Expo SDK 58 app with Expo Router, tabs for Home, Support, Appointments and Messages.

## Getting started with Expo Go

1. Install dependencies from the monorepo root: `pnpm install`
2. Start the Metro bundler: `pnpm --filter @nestself/mobile start`
3. Open Expo Go on your device and scan the QR code.

## Watchman note

Watchman is not available on this machine. Metro falls back to polling, which works but uses more CPU. If you install Watchman later, Metro will use it automatically.

## Fonts

Custom Onest fonts are loaded via `expo-font` from `@nestself/assets/fonts/native/`. The splash screen stays visible until fonts are loaded.

## Uniwind upgrade path

When Expo adds first-class Tailwind / NativeWind support (Uniwind), the styling in `@nestself/ui-native` can migrate from inline StyleSheet objects to utility classes while keeping the same semantic token layer from `@nestself/tokens/native`.

## Export (JS bundle)

```sh
pnpm --filter @nestself/mobile export
```

This bundles the iOS JavaScript into `apps/mobile/dist` without requiring a native build or simulator.
