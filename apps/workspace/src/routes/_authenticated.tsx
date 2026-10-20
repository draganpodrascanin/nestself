import { createFileRoute, Outlet, Link, useMatches } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  House,
  Heart,
  CalendarCheck,
  ChatCircleText,
  Megaphone,
  ChartBar,
  Gear,
  Users,
  Buildings,
} from '@phosphor-icons/react';
import { AppShell, NavItem } from '@nestself/ui';
import { canManageTeam, canAccessHr } from '@nestself/contracts';
import { useSession } from '../session';
import { ApiStatus } from '../components/ApiStatus';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context }) => {
    // With the stub session, this is always true. In production it would redirect to login.
    if (!context.session) {
      throw new Error('Session required');
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { t } = useTranslation('common');
  const { session } = useSession();
  const matches = useMatches();

  const isActive = (path: string) => {
    return matches.some((m) => m.pathname === path || m.pathname.startsWith(path + '/'));
  };

  const navItems = [
    { to: '/' as const, icon: House, label: t('nav.home') },
    { to: '/support' as const, icon: Heart, label: t('nav.support') },
    { to: '/appointments' as const, icon: CalendarCheck, label: t('nav.appointments') },
    { to: '/messages' as const, icon: ChatCircleText, label: t('nav.messages') },
    { to: '/channels' as const, icon: Megaphone, label: t('nav.channels') },
    { to: '/polls' as const, icon: ChartBar, label: t('nav.polls') },
    { to: '/settings' as const, icon: Gear, label: t('nav.settings') },
  ];

  const managerNav = canManageTeam(session)
    ? [{ to: '/manage' as const, icon: Users, label: t('nav.manage') }]
    : [];

  const hrNav = canAccessHr(session)
    ? [{ to: '/hr' as const, icon: Buildings, label: t('nav.hr') }]
    : [];

  const allNavItems = [...navItems, ...managerNav, ...hrNav];

  const renderNavItems = (_variant: 'sidebar' | 'bottom') =>
    allNavItems.map((item) => (
      <NavItem
        key={item.to}
        href={item.to}
        icon={item.icon}
        label={item.label}
        active={item.to === '/' ? matches[matches.length - 1]?.pathname === '/' : isActive(item.to)}
        render={(props) => (
          <Link
            to={item.to}
            className={props.className}
            aria-current={props['aria-current']}
          >
            {props.children}
          </Link>
        )}
      />
    ));

  const sidebar = (
    <nav aria-label={t('nav.menu')} className="flex flex-col gap-1 p-4">
      <p className="type-label text-primary px-2 py-3">NestSelf</p>
      {renderNavItems('sidebar')}
    </nav>
  );

  const topbar = (
    <div className="flex items-center justify-between w-full">
      <p className="type-label text-primary">NestSelf</p>
      <ApiStatus />
    </div>
  );

  const bottomBar = (
    <nav aria-label={t('nav.menu')} className="flex justify-around items-center py-1">
      {renderNavItems('bottom')}
    </nav>
  );

  return (
    <AppShell sidebar={sidebar} topbar={topbar} bottomBar={bottomBar}>
      <Outlet />
    </AppShell>
  );
}
