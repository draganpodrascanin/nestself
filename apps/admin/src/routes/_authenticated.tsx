import { createFileRoute, Outlet, Link, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { House, Users, Buildings, Article, CalendarCheck, GearSix, ShieldCheck, Siren } from '@phosphor-icons/react';
import { AppShell, NavItem, StatusBlock } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth, resolveRouteAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
import { ApiStatus } from './__root';
import { UserMenu } from '../features/account/user-menu';
import { ContextPicker } from '../features/context/context-picker';

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
  const { t } = useTranslation('admin');
  const { principal, effectiveActions } = useAuth();

  // Access gate: must have relevant admin permissions (CLIENT-R-05/06).
  // Smallest honest rule: at least one of these, or having staff templates.
  const hasAccess =
    principal &&
    (can(principal, 'client.configure', undefined, effectiveActions) ||
      can(principal, 'content.publish', undefined, effectiveActions) ||
      principal.staffTemplates.length > 0);

  // Signed out (for example just after Sign out, before /sign-in renders):
  // render nothing rather than flash the permission block.
  if (!principal) return null;

  if (!hasAccess) {
    return <PermissionBlock />;
  }

  const showAccess = can(principal, 'access.preview', undefined, effectiveActions);
  // Convenience only: `GET /ops/emergency-access` enforces `audit.read`.
  const showEmergency = can(principal, 'audit.read', undefined, effectiveActions);

  const navItems = [
    { to: '/' as const, icon: House, label: t('nav.overview') },
    { to: '/experts' as const, icon: Users, label: t('nav.experts') },
    { to: '/organizations' as const, icon: Buildings, label: t('nav.organizations') },
    ...(showAccess ? [{ to: '/access' as const, icon: ShieldCheck, label: t('nav.access') }] : []),
    ...(showEmergency ? [{ to: '/emergency' as const, icon: Siren, label: t('nav.emergency') }] : []),
    { to: '/content' as const, icon: Article, label: t('nav.content') },
    { to: '/event-requests' as const, icon: CalendarCheck, label: t('nav.eventRequests') },
    { to: '/settings' as const, icon: GearSix, label: t('nav.settings') },
  ];

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
        <div className="flex w-full min-w-0 items-center justify-between gap-2">
          <span className="shrink-0 font-[var(--font-weight-label)] text-primary">NestSelf Admin</span>
          <div className="flex min-w-0 items-center gap-2 @min-[480px]:gap-4">
            {/* Hidden on narrow screens so the header fits 320px (WCAG reflow); the sample banner still shows. */}
            <div className="hidden @min-[480px]:block">
              <ApiStatus />
            </div>
            <ContextPicker sampleMode={isSampleDataMode} />
            <UserMenu />
          </div>
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
