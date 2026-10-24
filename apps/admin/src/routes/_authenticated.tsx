import { createFileRoute, Outlet, Link, redirect } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { House, Users, Buildings, Article, CalendarCheck, GearSix, ShieldCheck } from '@phosphor-icons/react';
import { AppShell, NavItem, StatusBlock } from '@nestself/ui';
import { can } from '@nestself/contracts';
import { useAuth } from '../auth';
import { isSampleDataMode } from '../data-source';
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
  const { t } = useTranslation('admin');
  const { principal, effectiveActions } = useAuth();

  // Access gate: must have relevant admin permissions (CLIENT-R-05/06).
  // Smallest honest rule: at least one of these, or having staff templates.
  const hasAccess =
    principal &&
    (can(principal, 'client.configure', undefined, effectiveActions) ||
      can(principal, 'content.publish', undefined, effectiveActions) ||
      principal.staffTemplates.length > 0);

  if (!hasAccess) {
    return <PermissionBlock />;
  }

  const showAccess = can(principal, 'access.preview', undefined, effectiveActions);

  const navItems = [
    { to: '/' as const, icon: House, label: t('nav.overview') },
    { to: '/experts' as const, icon: Users, label: t('nav.experts') },
    { to: '/organizations' as const, icon: Buildings, label: t('nav.organizations') },
    ...(showAccess ? [{ to: '/access' as const, icon: ShieldCheck, label: t('nav.access') }] : []),
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
      <Outlet />
    </AppShell>
  );
}

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    // In sample mode a principal always exists; in real mode redirect to sign-in.
    if (!isSampleDataMode && !context.auth.principal) {
      throw redirect({ to: '/sign-in', search: { return: location.pathname } });
    }
  },
  component: AuthenticatedLayout,
});
