'use client';

import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { SiteHeader } from '@nestself/ui';
import { LinkButton } from '@nestself/ui';
import type { Locale } from '@nestself/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';

export interface SiteHeaderBarProps {
  locale: Locale;
}

export function SiteHeaderBar({ locale }: SiteHeaderBarProps) {
  const { t } = useTranslation(['marketing', 'common']);
  const pathname = usePathname();

  /** Strip the locale prefix and return the remaining path. */
  function currentPath(): string {
    const segments = pathname.split('/');
    // segments[0] is '', segments[1] is the locale, rest is the path
    return '/' + segments.slice(2).join('/');
  }

  const current = currentPath();

  const links = [
    { label: t('marketing:nav.services'), href: `/${locale}/services` },
    { label: t('marketing:nav.forEmployers'), href: `/${locale}/for-employers` },
    { label: t('marketing:nav.forEmployees'), href: `/${locale}/for-employees` },
    { label: t('marketing:nav.resources'), href: `/${locale}/resources` },
    { label: t('marketing:nav.plans'), href: `/${locale}/plans` },
    { label: t('marketing:nav.about'), href: `/${locale}/about` },
  ].map((link) => ({
    ...link,
    current:
      current === link.href.replace(`/${locale}`, '') ||
      (current === '/' && link.href === `/${locale}`),
  }));

  return (
    <SiteHeader
      brand={{
        label: 'nestself',
        href: `/${locale}`,
        className: 'text-[1.9rem] tracking-[-0.065em]',
      }}
      links={links}
      actions={
        <div className="gap-4 flex items-center @max-[760px]:flex-col @max-[760px]:items-stretch">
          <LocaleSwitcher locale={locale} />
          <LinkButton href={`/${locale}/demo`} size="sm">
            {t('marketing:actions.requestDemo')}
          </LinkButton>
        </div>
      }
      menuLabel={t('common:nav.openMenu')}
      closeLabel={t('common:nav.closeMenu')}
    />
  );
}
