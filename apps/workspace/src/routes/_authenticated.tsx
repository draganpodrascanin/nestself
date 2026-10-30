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
  UsersThree,
  TreeStructure,
  Briefcase,
  ChatsCircle,
  SealCheck,
  SlidersHorizontal,
  Presentation,
} from '@phosphor-icons/react';
import { AppShell, NavItem } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth, resolveRouteAuth } from '../auth';
import { ApiStatus } from '../components/ApiStatus';
import { UserMenu } from '../features/account/user-menu';
import { ContextPicker } from '../features/context/context-picker';
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

  // `/hr/people` and `/hr/org-units` sit under the `_hr` gate as well.
  const peopleNav = showHr
    ? [{ to: '/hr/people' as const, icon: UsersThree, label: t('workspace:people.nav') }]
    : [];

  const showOrgUnits =
    showHr && principal ? can(principal, 'org_units.manage', undefined, effectiveActions) : false;
  const orgUnitsNav = showOrgUnits
    ? [{ to: '/hr/org-units' as const, icon: TreeStructure, label: t('workspace:orgUnits.nav') }]
    : [];

  const accessNav = showAccess
    ? [{ to: '/hr/access' as const, icon: ShieldCheck, label: t('workspace:access.nav') }]
    : [];

  // Expert area: an expert record, or the assigned-read action in this context.
  const showCases = principal
    ? principal.expert !== null || can(principal, 'conversation.read.assigned', undefined, effectiveActions)
    : false;
  const casesNav = showCases
    ? [{ to: '/cases' as const, icon: Briefcase, label: t('workspace:cases.nav') }]
    : [];

  // The participant list, outside the expert context (an expert reads cases there).
  const showConversations = principal
    ? principal.context.kind !== 'expert' &&
      can(principal, 'conversation.participate', undefined, effectiveActions)
    : false;
  const conversationsNav = showConversations
    ? [{ to: '/conversations' as const, icon: ChatsCircle, label: t('workspace:conversations.nav') }]
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

  const allNavItems = [
    ...navItems,
    ...webinarsNav,
    ...conversationsNav,
    ...casesNav,
    ...managerNav,
    ...approvalsNav,
    ...hrNav,
    ...peopleNav,
    ...orgUnitsNav,
    ...accessNav,
    ...followUpPolicyNav,
  ];

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
    <div className="flex w-full min-w-0 items-center justify-between gap-2">
      <p className="shrink-0 type-label text-primary">NestSelf</p>
      <div className="flex min-w-0 items-center gap-2 @min-[480px]:gap-4">
        {/* Hidden on narrow screens so the header fits 320px (WCAG reflow); the sample banner still shows. */}
        <div className="hidden @min-[480px]:block">
          <ApiStatus />
        </div>
        <ContextPicker sampleMode={isSampleDataMode} />
        <UserMenu />
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
      {/* Follow-up proposals and reminders on the user's own room, on every page (CALL-42, CALL-01). */}
      <UserRoomListener />
      <Outlet />
    </AppShell>
  );
}
