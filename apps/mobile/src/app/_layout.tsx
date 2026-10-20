import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { I18nextProvider } from 'react-i18next';
import { useTheme } from '@nestself/ui-native';
import i18n, { loadPersistedLocale } from '@/i18n';
import { AppThemeProvider } from '@/providers/theme';
import { SessionProvider } from '@/providers/session';

// Prevent the splash screen from hiding until fonts are loaded.
void SplashScreen.preventAutoHideAsync();

function InnerLayout() {
  const { colors, mode } = useTheme();

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
        <SessionProvider>
          <InnerLayout />
        </SessionProvider>
      </AppThemeProvider>
    </I18nextProvider>
  );
}
