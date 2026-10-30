import { Fragment, useState } from 'react';
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
  DotsThree,
  UsersThree,
  TreeStructure,
  Briefcase,
  ChatsCircle,
} from '@phosphor-icons/react';
import { AppShell, NavItem, Sheet, SheetTrigger, SheetContent } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth, resolveRouteAuth } from '../auth';
import { ApiStatus } from '../components/ApiStatus';
import { UserMenu } from '../features/account/user-menu';
import { ContextPicker } from '../features/context/context-picker';
import { isSampleDataMode } from '../data-source';

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
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (path: string) =>
    matches.some((m) => m.pathname === path || m.pathname.startsWith(path + '/'));

  // Permission checks
  const canRead = principal
    ? can(principal, 'content.read', undefined, effectiveActions)
    : false;
  const canBookmark = principal
    ? can(principal, 'content.bookmark', undefined, effectiveActions)
    : false;
  const showManager = principal
    ? can(principal, 'events.request', undefined, effectiveActions)
    : false;
  const showHr = principal
    ? can(principal, 'program.overview', undefined, effectiveActions)
    : false;
  const showAccess =
    showHr && principal ? can(principal, 'access.preview', undefined, effectiveActions) : false;

  // Build nav items — Explore hidden without content.read, Saved without content.bookmark
  const coreNavItems: NavEntry[] = [
    { to: '/', icon: House, label: t('library:nav.home') },
    ...(isSampleDataMode || canRead
      ? [{ to: '/explore', icon: Compass, label: t('library:nav.explore') }]
      : []),
    ...(canBookmark
      ? [{ to: '/saved', icon: BookmarkSimple, label: t('library:nav.saved') }]
      : []),
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

  const managerNav: NavEntry[] = showManager
    ? [{ to: '/manage', icon: Users, label: t('common:nav.manage') }]
    : [];

  const hrNav: NavEntry[] = showHr
    ? [{ to: '/hr', icon: Buildings, label: t('common:nav.hr') }]
    : [];

  // `/hr/people` and `/hr/org-units` sit under the `_hr` gate as well.
  const peopleNav: NavEntry[] = showHr
    ? [{ to: '/hr/people', icon: UsersThree, label: t('workspace:people.nav') }]
    : [];

  const showOrgUnits =
    showHr && principal ? can(principal, 'org_units.manage', undefined, effectiveActions) : false;
  const orgUnitsNav: NavEntry[] = showOrgUnits
    ? [{ to: '/hr/org-units', icon: TreeStructure, label: t('workspace:orgUnits.nav') }]
    : [];

  const accessNav: NavEntry[] = showAccess
    ? [{ to: '/hr/access', icon: ShieldCheck, label: t('workspace:access.nav') }]
    : [];

  // Expert area: an expert record, or the assigned-read action in this context.
  const showCases = principal
    ? principal.expert !== null || can(principal, 'conversation.read.assigned', undefined, effectiveActions)
    : false;
  const casesNav: NavEntry[] = showCases
    ? [{ to: '/cases', icon: Briefcase, label: t('workspace:cases.nav') }]
    : [];

  // The participant list, outside the expert context (an expert reads cases there).
  const showConversations = principal
    ? principal.context.kind !== 'expert' &&
      can(principal, 'conversation.participate', undefined, effectiveActions)
    : false;
  const conversationsNav: NavEntry[] = showConversations
    ? [{ to: '/conversations', icon: ChatsCircle, label: t('workspace:conversations.nav') }]
    : [];

  const allNavItems = [
    ...coreNavItems,
    ...prototypeItems,
    ...conversationsNav,
    ...casesNav,
    ...managerNav,
    ...hrNav,
    ...peopleNav,
    ...orgUnitsNav,
    ...accessNav,
  ];

  /**
   * Bottom bar: up to 5 slots.
   * When overflow items exist (Manage, HR, Access, prototype screens), the
   * last slot becomes "More" which opens a bottom sheet listing everything
   * not already in the bar. Settings moves into the sheet in that case.
   */
  const overflowItems = allNavItems.filter(
    (item) => !coreNavItems.slice(0, 4).some((c) => c.to === item.to),
  );
  const hasOverflow = overflowItems.length > 1; // >1 because Settings alone is fine
  const bottomBarItems = hasOverflow ? coreNavItems.slice(0, 4) : coreNavItems.slice(0, 5);
  // When overflow, include Settings + everything else not in the first 4 core items
  const moreSheetItems = hasOverflow ? overflowItems : [];

  // ---------------------------------------------------------------------------
  // Sidebar rendering — groups are semantic (`role="group"` + `aria-labelledby`)
  // ---------------------------------------------------------------------------

  const renderSidebarNav = (items: NavEntry[]) => {
    const groups: { label: string | null; items: NavEntry[] }[] = [];
    for (const item of items) {
      const last = groups[groups.length - 1];
      const itemGroup = item.group ?? null;
      if (!last || last.label !== itemGroup) {
        groups.push({ label: itemGroup, items: [item] });
      } else {
        last.items.push(item);
      }
    }

    return groups.map((group, gi) => {
      const navItems = group.items.map((item) => (
        <NavItem
          key={item.to}
          variant="sidebar"
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
      ));

      if (group.label) {
        const labelId = `nav-group-${gi}`;
        return (
          <div key={`group-${gi}`} role="group" aria-labelledby={labelId}>
            <p id={labelId} className="px-2 pt-4 pb-1 type-metadata text-text-secondary">
              {group.label}
            </p>
            {navItems}
          </div>
        );
      }
      return <Fragment key={`group-${gi}`}>{navItems}</Fragment>;
    });
  };

  // ---------------------------------------------------------------------------
  // Bottom bar rendering — wrapper carries flex-child classes so NavItem can
  // shrink and truncate at narrow widths (the wrapper was previously a plain
  // <div> that defeated `flex-1 basis-0 min-w-0`).
  // ---------------------------------------------------------------------------

  const renderBottomBarItems = (items: NavEntry[]) =>
    items.map((item) => (
      <div key={item.to} className="flex-1 basis-0 min-w-0">
        <NavItem
          variant="bottom"
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
    ));

  const sidebar = (
    <nav aria-label={t('common:nav.menu')} className="gap-1 p-4 flex flex-col">
      <p className="px-2 py-3 type-label text-primary">NestSelf</p>
      {renderSidebarNav(allNavItems)}
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
    <nav aria-label={t('common:nav.menu')} className="py-1 flex items-center justify-around">
      {renderBottomBarItems(bottomBarItems)}
      {hasOverflow ? (
        <div className="flex-1 basis-0 min-w-0">
          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger>
              <NavItem
                variant="bottom"
                href="#more"
                icon={DotsThree}
                label={t('library:nav.more')}
                render={(props) => (
                  <button type="button" className={props.className}>
                    {props.children}
                  </button>
                )}
              />
            </SheetTrigger>
            <SheetContent
              title={t('library:nav.more')}
              side="bottom"
              closeLabel={t('common:action.close', { defaultValue: 'Close' })}
            >
              <nav aria-label={t('library:nav.more')} className="flex flex-col gap-1">
                {moreSheetItems.map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    onClick={() => setMoreOpen(false)}
                    className="flex items-center gap-3 px-3 py-3 rounded-control text-text no-underline hover:bg-tint transition"
                  >
                    <item.icon size={20} aria-hidden />
                    <span className="type-body">{item.label}</span>
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      ) : null}
    </nav>
  );

  return (
    <AppShell sidebar={sidebar} topbar={topbar} bottomBar={bottomBar}>
      <Outlet />
    </AppShell>
  );
}
