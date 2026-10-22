import { useEffect, useState } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { I18nextProvider } from 'react-i18next';
import { useTheme } from '@nestself/ui-native';
import i18n, { loadPersistedLocale } from '@/i18n';
import { AppThemeProvider } from '@/providers/theme';
import { AuthProvider } from '@/auth/auth-provider';
import { useAuth } from '@/auth/use-auth';

// Prevent the splash screen from hiding until fonts are loaded.
void SplashScreen.preventAutoHideAsync();

/**
 * Inner layout: redirects based on auth status.
 *
 * - `loading`: show nothing (splash still visible).
 * - `authenticated`: redirect to tabs if currently on an auth screen.
 * - `unauthenticated`: redirect to sign-in if currently on a protected screen.
 */
function InnerLayout() {
  const { colors, mode } = useTheme();
  const { status } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (status === 'loading') return;

    // segments[0] is the route group name. Typed routes may not include
    // (auth) until the next expo build regenerates the type declarations.
    const firstSegment = segments[0] as string | undefined;
    const inAuthGroup = firstSegment === '(auth)';

    if (status === 'unauthenticated' && !inAuthGroup) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.replace('/(auth)/sign-in' as any);
    } else if (status === 'authenticated' && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [status, segments, router]);

  return (
    <>
      <StatusBar style={mode === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.canvas },
        }}
      />
    </>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'Onest-Regular': require('@nestself/assets/fonts/native/Onest-Regular.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'Onest-SemiBold': require('@nestself/assets/fonts/native/Onest-SemiBold.ttf'),
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    'Onest-Bold': require('@nestself/assets/fonts/native/Onest-Bold.ttf'),
  });

  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    void loadPersistedLocale().then(() => setI18nReady(true));
  }, []);

  useEffect(() => {
    if (fontsLoaded && i18nReady) {
      void SplashScreen.hideAsync();
    }
  }, [fontsLoaded, i18nReady]);

  if (!fontsLoaded || !i18nReady) {
    return null;
  }

  return (
    <I18nextProvider i18n={i18n}>
      <AppThemeProvider>
        <AuthProvider>
          <InnerLayout />
        </AuthProvider>
      </AppThemeProvider>
    </I18nextProvider>
  );
}
