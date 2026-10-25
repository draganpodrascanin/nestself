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
  ShieldCheck,
  BookmarkSimple,
  Compass,
  PaperPlaneTilt,
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

interface NavEntry {
  to: string;
  icon: typeof House;
  label: string;
  group?: string;
}

function AuthenticatedLayout() {
  const { t } = useTranslation(['common', 'workspace', 'library']);
  const { principal, effectiveActions } = useAuth();
  const matches = useMatches();

  const isActive = (path: string) =>
    matches.some((m) => m.pathname === path || m.pathname.startsWith(path + '/'));

  // In api mode: Home, Explore, Saved, My requests (CLI-R-04)
  const apiNavItems: NavEntry[] = [
    { to: '/', icon: House, label: t('library:nav.home') },
    { to: '/explore', icon: Compass, label: t('library:nav.explore') },
    { to: '/saved', icon: BookmarkSimple, label: t('library:nav.saved') },
    { to: '/requests', icon: PaperPlaneTilt, label: t('library:nav.myRequests') },
    { to: '/settings', icon: Gear, label: t('common:nav.settings') },
  ];

  // Legacy sample-mode nav
  const sampleNavItems: NavEntry[] = [
    { to: '/', icon: House, label: t('library:nav.home') },
    { to: '/explore', icon: Compass, label: t('library:nav.explore') },
    { to: '/saved', icon: BookmarkSimple, label: t('library:nav.saved') },
    { to: '/requests', icon: PaperPlaneTilt, label: t('library:nav.myRequests') },
    { to: '/settings', icon: Gear, label: t('common:nav.settings') },
  ];

  // Prototype screens only in sample mode (CLI-R-05)
  const prototypeItems: NavEntry[] = isSampleDataMode
    ? [
        { to: '/support', icon: Heart, label: t('common:nav.support'), group: t('library:prototype.group') },
        { to: '/appointments', icon: CalendarCheck, label: t('common:nav.appointments'), group: t('library:prototype.group') },
        { to: '/messages', icon: ChatCircleText, label: t('common:nav.messages'), group: t('library:prototype.group') },
        { to: '/channels', icon: Megaphone, label: t('common:nav.channels'), group: t('library:prototype.group') },
        { to: '/polls', icon: ChartBar, label: t('common:nav.polls'), group: t('library:prototype.group') },
      ]
    : [];

  const mainItems = isSampleDataMode ? sampleNavItems : apiNavItems;

  const showManager = principal
    ? can(principal, 'events.request', undefined, effectiveActions)
    : false;
  const showHr = principal
    ? can(principal, 'program.overview', undefined, effectiveActions)
    : false;

  const managerNav: NavEntry[] = showManager
    ? [{ to: '/manage', icon: Users, label: t('common:nav.manage') }]
    : [];

  const showAccess =
    showHr && principal ? can(principal, 'access.preview', undefined, effectiveActions) : false;

  const hrNav: NavEntry[] = showHr
    ? [{ to: '/hr', icon: Buildings, label: t('common:nav.hr') }]
    : [];

  const accessNav: NavEntry[] = showAccess
    ? [{ to: '/hr/access', icon: ShieldCheck, label: t('workspace:access.nav') }]
    : [];

  const allNavItems = [...mainItems, ...prototypeItems, ...managerNav, ...hrNav, ...accessNav];

  /** Bottom bar: at most 5 items (main nav only). */
  const bottomBarItems = mainItems.slice(0, 4);

  const renderNavItemList = (
    items: typeof allNavItems,
    variant: 'sidebar' | 'bottom' = 'sidebar',
  ) =>
    items.map((item, index) => {
      const prevGroup = items.slice(0, index).reverse().find((i) => i.group)?.group;
      const groupLabel =
        variant === 'sidebar' && item.group && item.group !== prevGroup
          ? item.group
          : null;

      return (
        <div key={item.to}>
          {groupLabel ? (
            <p className="px-2 pt-4 pb-1 type-metadata text-text-secondary">
              {groupLabel}
            </p>
          ) : null}
          <NavItem
            variant={variant}
            href={item.to}
            icon={item.icon}
            label={item.label}
            active={
              item.to === '/'
                ? matches[matches.length - 1]?.pathname === '/'
                : isActive(item.to)
            }
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
        </div>
      );
    });

  const sidebar = (
    <nav aria-label={t('common:nav.menu')} className="gap-1 p-4 flex flex-col">
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
    <nav aria-label={t('common:nav.menu')} className="py-1 flex items-center justify-around">
      {renderNavItemList(bottomBarItems, 'bottom')}
    </nav>
  );

  return (
    <AppShell sidebar={sidebar} topbar={topbar} bottomBar={bottomBar}>
      <Outlet />
    </AppShell>
  );
}
