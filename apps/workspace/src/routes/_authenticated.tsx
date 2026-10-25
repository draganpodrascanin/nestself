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
  SealCheck,
  SlidersHorizontal,
  Presentation,
} from '@phosphor-icons/react';
import { AppShell, NavItem } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth, resolveRouteAuth } from '../auth';
import { ApiStatus } from '../components/ApiStatus';
import { isSampleDataMode } from '../data-source';
import { UserRoomListener } from '../calls/user-room-listener';
import { canAttendWebinars } from '../webinars/route-gate';

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: async ({ context, location }) => {
    // In sample mode a principal always exists; in real mode redirect to
    // sign-in, after waiting for the session on a full page load.
    if (isSampleDataMode) return;
    const { principal } = await resolveRouteAuth(context.auth);
    if (!principal) {
      throw redirect({ to: '/sign-in', search: { return: location.pathname } });
    }
  },
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  const { t } = useTranslation(['common', 'workspace', 'calls']);
  const { principal, effectiveActions } = useAuth();
  const matches = useMatches();

  const isActive = (path: string) =>
    matches.some((m) => m.pathname === path || m.pathname.startsWith(path + '/'));

  // Appointments only for someone who can hold consultations (an HR-only principal has none).
  const showAppointments = principal ? can(principal, 'consultation.join', undefined, effectiveActions) : false;
  const appointmentsNav = showAppointments ? [{ to: '/appointments' as const, icon: CalendarCheck, label: t('nav.appointments') }] : [];

  const navItems = [
    { to: '/' as const, icon: House, label: t('nav.home') },
    { to: '/support' as const, icon: Heart, label: t('nav.support') },
    ...appointmentsNav,
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

  // `/hr/access` sits under the `_hr` gate, so it needs `program.overview` too.
  const showAccess =
    showHr && principal ? can(principal, 'access.preview', undefined, effectiveActions) : false;

  const hrNav = showHr
    ? [{ to: '/hr' as const, icon: Buildings, label: t('nav.hr') }]
    : [];

  const accessNav = showAccess
    ? [{ to: '/hr/access' as const, icon: ShieldCheck, label: t('workspace:access.nav') }]
    : [];

  // Follow-up approvals (T-CW-1.10): the approver's items, and HR's policy under the `_hr` gate.
  const showApprovals = principal ? can(principal, 'approval.decide', undefined, effectiveActions) : false;
  const approvalsNav = showApprovals
    ? [{ to: '/approvals' as const, icon: SealCheck, label: t('nav.approvals') }]
    : [];
  const followUpPolicyNav = showHr
    ? [{ to: '/follow-up-policy' as const, icon: SlidersHorizontal, label: t('nav.followUpPolicy') }]
    : [];

  // Webinars (T-CW-2.4): discovery and registration for holders of `event.register`.
  const webinarsNav = canAttendWebinars(principal, effectiveActions)
    ? [{ to: '/webinars' as const, icon: Presentation, label: t('calls:webinar.nav') }]
    : [];

  const allNavItems = [...navItems, ...webinarsNav, ...managerNav, ...approvalsNav, ...hrNav, ...accessNav, ...followUpPolicyNav];

  /** Bottom bar: at most 5 items. */
  const bottomBarItems = [
    { to: '/' as const, icon: House, label: t('nav.home') },
    { to: '/support' as const, icon: Heart, label: t('nav.support') },
    ...appointmentsNav,
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
      <ApiStatus />
    </div>
  );

  const bottomBar = (
    <nav aria-label={t('nav.menu')} className="py-1 flex items-center justify-around">
      {renderNavItemList(bottomBarItems, 'bottom')}
    </nav>
  );

  return (
    <AppShell sidebar={sidebar} topbar={topbar} bottomBar={bottomBar}>
      {/* Follow-up proposals and reminders on the user's own room, on every page (CALL-42, CALL-01). */}
      <UserRoomListener />
      <Outlet />
    </AppShell>
  );
}
