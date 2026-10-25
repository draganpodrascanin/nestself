import { createFileRoute, Outlet, Link, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { House, Users, Buildings, Article, CalendarCheck, GearSix, ShieldCheck, VideoCamera, Presentation } from '@phosphor-icons/react';
import { AppShell, NavItem, StatusBlock } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth, resolveRouteAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { canListConsultations, isConsultingExpert } from '../calls/route-gate';
import { UserRoomListener } from '../calls/user-room-listener';
import { canListWebinars } from '../webinars/route-gate';
import { ApiStatus } from './__root';

function PermissionBlock() {
  const { t } = useTranslation('common');

  return (
    <div className="p-6 flex min-h-screen items-center justify-center">
      <StatusBlock
        state="permission"
        title={t('state.permission.title')}
        body={t('state.permission.body')}
      />
    </div>
  );
}

function AuthenticatedLayout() {
  const { t } = useTranslation(['admin', 'calls']);
  const { principal, effectiveActions } = useAuth();

  // Access gate: must have relevant admin permissions (CLIENT-R-05/06).
  // Smallest honest rule: at least one of these, or having staff templates.
  const staffAccess =
    !!principal &&
    (can(principal, 'client.configure', undefined, effectiveActions) ||
      can(principal, 'content.publish', undefined, effectiveActions) ||
      principal.staffTemplates.length > 0);
  // Experts hold no staff template; their admin space is their consultations (T-CW-1.5).
  const expertAccess = isConsultingExpert(principal, effectiveActions);

  if (!principal || (!staffAccess && !expertAccess)) {
    return <PermissionBlock />;
  }

  const showAccess = can(principal, 'access.preview', undefined, effectiveActions);
  const consultationsNav = canListConsultations(principal, effectiveActions)
    ? [{ to: '/consultations' as const, icon: VideoCamera, label: t('calls:consultations.nav') }]
    : [];

  // Webinars (T-CW-2.4): occurrences for `event.manage` and `event.moderate`.
  const webinarsNav = canListWebinars(principal, effectiveActions)
    ? [{ to: '/webinars' as const, icon: Presentation, label: t('calls:webinar.nav') }]
    : [];

  const navItems = staffAccess
    ? [
        { to: '/' as const, icon: House, label: t('nav.overview') },
        ...consultationsNav,
        ...webinarsNav,
        { to: '/experts' as const, icon: Users, label: t('nav.experts') },
        { to: '/organizations' as const, icon: Buildings, label: t('nav.organizations') },
        ...(showAccess ? [{ to: '/access' as const, icon: ShieldCheck, label: t('nav.access') }] : []),
        { to: '/content' as const, icon: Article, label: t('nav.content') },
        { to: '/event-requests' as const, icon: CalendarCheck, label: t('nav.eventRequests') },
        { to: '/settings' as const, icon: GearSix, label: t('nav.settings') },
      ]
    : [...consultationsNav, { to: '/settings' as const, icon: GearSix, label: t('nav.settings') }];

  return (
    <AppShell
      maxWidth="hr"
      sidebar={
        <nav className="gap-1 p-4 flex flex-col" aria-label="Admin navigation">
          {navItems.map((item) => (
            <NavItem
              key={item.to}
              href={item.to}
              icon={item.icon}
              label={item.label}
              render={(props) => (
                <Link
                  to={item.to}
                  className={props.className}
                  aria-current={props['aria-current']}
                  activeProps={{ className: 'text-primary font-[var(--font-weight-label)]' }}
                >
                  {props.children}
                </Link>
              )}
            />
          ))}
        </nav>
      }
      topbar={
        <div className="flex w-full items-center justify-between">
          <span className="font-[var(--font-weight-label)] text-primary">NestSelf Admin</span>
          <ApiStatus />
        </div>
      }
      bottomBar={
        <nav className="flex h-full items-center justify-around" aria-label={t('common:nav.menu')}>
          {navItems.slice(0, 4).map((item) => (
            <NavItem
              key={item.to}
              variant="bottom"
              href={item.to}
              icon={item.icon}
              label={item.label}
              render={(props) => (
                <Link
                  to={item.to}
                  className={props.className}
                  aria-current={props['aria-current']}
                  activeProps={{ className: 'text-primary font-[var(--font-weight-label)]' }}
                >
                  {props.children}
                </Link>
              )}
            />
          ))}
        </nav>
      }
    >
      {/* Suggested times and reminders on the user's own room, on every page (T-CW-1.9, CALL-01). */}
      <UserRoomListener />
      <Outlet />
    </AppShell>
  );
}

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
