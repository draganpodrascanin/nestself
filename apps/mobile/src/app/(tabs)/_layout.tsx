import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@nestself/ui-native';
import {
  House,
  Heart,
  CalendarCheck,
  ChatCircleText,
} from 'phosphor-react-native';

export default function TabsLayout() {
  const { t } = useTranslation('mobile');
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.borderSubtle,
          height: Math.max(64, 64 + insets.bottom),
          paddingBottom: insets.bottom,
        },
        tabBarLabelStyle: {
          fontFamily: 'Onest-SemiBold',
          fontSize: 11,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t('tabs.home'),
          tabBarIcon: ({ color, focused }) => (
            <House
              size={24}
              weight={focused ? 'fill' : 'regular'}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="support"
        options={{
          title: t('tabs.support'),
          tabBarIcon: ({ color, focused }) => (
            <Heart
              size={24}
              weight={focused ? 'fill' : 'regular'}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="appointments"
        options={{
          title: t('tabs.appointments'),
          tabBarIcon: ({ color, focused }) => (
            <CalendarCheck
              size={24}
              weight={focused ? 'fill' : 'regular'}
              color={color as string}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: t('tabs.messages'),
          tabBarIcon: ({ color, focused }) => (
            <ChatCircleText
              size={24}
              weight={focused ? 'fill' : 'regular'}
              color={color as string}
            />
          ),
        }}
      />
    </Tabs>
  );
}
