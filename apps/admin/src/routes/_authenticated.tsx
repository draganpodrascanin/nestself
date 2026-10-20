import { createFileRoute, Outlet, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  House,
  Users,
  Buildings,
  Article,
  CalendarCheck,
  GearSix,
} from '@phosphor-icons/react';
import { AppShell, NavItem, StatusBlock } from '@nestself/ui';
import { ApiStatus } from './__root';

function PermissionBlock() {
  const { t } = useTranslation('common');

  return (
    <div className="flex items-center justify-center min-h-screen p-6">
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
  const ctx = Route.useRouteContext();

  if (!ctx.session.platformRole) {
    return <PermissionBlock />;
  }

  const navItems = [
    { to: '/', icon: House, label: t('nav.overview') },
    { to: '/experts', icon: Users, label: t('nav.experts') },
    { to: '/organizations', icon: Buildings, label: t('nav.organizations') },
    { to: '/content', icon: Article, label: t('nav.content') },
    { to: '/event-requests', icon: CalendarCheck, label: t('nav.eventRequests') },
    { to: '/settings', icon: GearSix, label: t('nav.settings') },
  ] as const;

  return (
    <AppShell
      maxWidth="hr"
      sidebar={
        <nav className="flex flex-col gap-1 p-4" aria-label="Admin navigation">
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
        <div className="flex items-center justify-between w-full">
          <span className="font-[var(--font-weight-label)] text-primary">NestSelf Admin</span>
          <ApiStatus />
        </div>
      }
      bottomBar={
        <nav className="flex items-center justify-around h-full" aria-label="Admin navigation">
          {navItems.slice(0, 4).map((item) => (
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
    >
      <Outlet />
    </AppShell>
  );
}

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context }) => {
    if (!context.session.platformRole) {
      // The component will render the permission block
    }
  },
  component: AuthenticatedLayout,
});
