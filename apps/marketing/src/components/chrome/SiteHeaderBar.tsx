'use client';

import { usePathname } from 'next/navigation';
import { useTranslation } from 'react-i18next';
import { SiteHeader } from '@nestself/ui';
import { LinkButton } from '@nestself/ui';
import type { Locale } from '@nestself/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { localePath, stripLocalePrefix } from '@nestself/i18n';

export interface SiteHeaderBarProps {
  locale: Locale;
}

export function SiteHeaderBar({ locale }: SiteHeaderBarProps) {
  const { t } = useTranslation(['marketing', 'common']);
  const pathname = usePathname();

  /** The locale-free path of the current page (Serbian Latin is unprefixed, the rest are prefixed). */
  const current = stripLocalePrefix(pathname).path;

  const links = [
    { label: t('marketing:nav.services'), href: localePath(locale, '/services') },
    { label: t('marketing:nav.forEmployers'), href: localePath(locale, '/for-employers') },
    { label: t('marketing:nav.forEmployees'), href: localePath(locale, '/for-employees') },
    { label: t('marketing:nav.resources'), href: localePath(locale, '/resources') },
    { label: t('marketing:nav.plans'), href: localePath(locale, '/plans') },
    { label: t('marketing:nav.about'), href: localePath(locale, '/about') },
  ].map((link) => ({
    ...link,
    current: stripLocalePrefix(link.href).path === current,
  }));

  return (
    <SiteHeader
      brand={{
        label: 'nestself',
        href: localePath(locale),
        className: 'text-[1.9rem] tracking-[-0.065em]',
      }}
      links={links}
      utilities={<LocaleSwitcher locale={locale} />}
      actions={
        <div className="@max-[1000px]:w-full">
          <LinkButton href={localePath(locale, '/demo')} size="sm" className="@max-[1000px]:w-full">
            {t('marketing:actions.requestDemo')}
          </LinkButton>
        </div>
      }
      menuLabel={t('common:nav.openMenu')}
      closeLabel={t('common:nav.closeMenu')}
    />
  );
}
