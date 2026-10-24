import { createFileRoute, Outlet, Link, useMatches, redirect } from '@tanstack/react-router';
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
import { can } from '@nestself/contracts';
import { useAuth } from '../auth';
import { ApiStatus } from '../components/ApiStatus';
import { ContextSwitcher } from '../components/ContextSwitcher';
import { isSampleDataMode } from '../data-source';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    // In sample mode a principal always exists; in real mode redirect to sign-in.
    if (!isSampleDataMode && !context.auth.principal) {
      throw redirect({ to: '/sign-in', search: { return: location.pathname } });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { t } = useTranslation('common');
  const { principal, effectiveActions } = useAuth();
  const matches = useMatches();

  const isActive = (path: string) =>
    matches.some((m) => m.pathname === path || m.pathname.startsWith(path + '/'));

  const navItems = [
    { to: '/' as const, icon: House, label: t('nav.home') },
    { to: '/support' as const, icon: Heart, label: t('nav.support') },
    { to: '/appointments' as const, icon: CalendarCheck, label: t('nav.appointments') },
    { to: '/messages' as const, icon: ChatCircleText, label: t('nav.messages') },
    { to: '/channels' as const, icon: Megaphone, label: t('nav.channels') },
    { to: '/polls' as const, icon: ChartBar, label: t('nav.polls') },
    { to: '/settings' as const, icon: Gear, label: t('nav.settings') },
  ];

  const showManager = principal
    ? can(principal, 'events.request', undefined, effectiveActions)
    : false;
  const showHr = principal
    ? can(principal, 'program.overview', undefined, effectiveActions)
    : false;

  const managerNav = showManager
    ? [{ to: '/manage' as const, icon: Users, label: t('nav.manage') }]
    : [];

  const hrNav = showHr
    ? [{ to: '/hr' as const, icon: Buildings, label: t('nav.hr') }]
    : [];

  const allNavItems = [...navItems, ...managerNav, ...hrNav];

  /** Bottom bar: at most 5 items. */
  const bottomBarItems = [
    { to: '/' as const, icon: House, label: t('nav.home') },
    { to: '/support' as const, icon: Heart, label: t('nav.support') },
    { to: '/appointments' as const, icon: CalendarCheck, label: t('nav.appointments') },
    { to: '/messages' as const, icon: ChatCircleText, label: t('nav.messages') },
    { to: '/channels' as const, icon: Megaphone, label: t('nav.channels') },
  ];

  const renderNavItemList = (
    items: typeof allNavItems,
    variant: 'sidebar' | 'bottom' = 'sidebar',
  ) =>
    items.map((item) => (
      <NavItem
        key={item.to}
        variant={variant}
        href={item.to}
        icon={item.icon}
        label={item.label}
        active={item.to === '/' ? matches[matches.length - 1]?.pathname === '/' : isActive(item.to)}
        render={(props) => (
          <Link to={item.to} className={props.className} aria-current={props['aria-current']}>
            {props.children}
          </Link>
        )}
      />
    ));

  const sidebar = (
    <nav aria-label={t('nav.menu')} className="gap-1 p-4 flex flex-col">
      <p className="px-2 py-3 type-label text-primary">NestSelf</p>
      {renderNavItemList(allNavItems)}
    </nav>
  );

  const topbar = (
    <div className="flex w-full items-center justify-between">
      <p className="type-label text-primary">NestSelf</p>
      <div className="flex items-center gap-3">
        <ContextSwitcher />
        <ApiStatus />
      </div>
    </div>
  );

  const bottomBar = (
    <nav aria-label={t('nav.menu')} className="py-1 flex items-center justify-around">
      {renderNavItemList(bottomBarItems, 'bottom')}
    </nav>
  );

  return (
    <AppShell sidebar={sidebar} topbar={topbar} bottomBar={bottomBar}>
      <Outlet />
    </AppShell>
  );
}
