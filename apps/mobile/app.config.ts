import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConfigContext, ExpoConfig } from 'expo/config';

// Read tokens.json via fs to avoid import-attribute issues in the Expo config loader.
const tokensPath = resolve(__dirname, '../../packages/tokens/tokens.json');
const tokens = JSON.parse(readFileSync(tokensPath, 'utf-8')) as {
  themes: { forest: { light: { canvas: string } } };
};

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'NestSelf',
  slug: 'nestself-mobile',
  scheme: 'nestself',
  version: '0.0.1',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  // SDK 58 supports newArchEnabled but ExpoConfig types may lag.
  ...(({ newArchEnabled: true }) as Record<string, unknown>),
  ios: { bundleIdentifier: 'com.nestself.mobile', supportsTablet: false },
  android: {
    package: 'com.nestself.mobile',
    adaptiveIcon: { backgroundColor: tokens.themes.forest.light.canvas },
  },
  plugins: [
    'expo-router',
    'expo-font',
    'expo-localization',
    'expo-splash-screen',
  ],
  experiments: { typedRoutes: true },
});
