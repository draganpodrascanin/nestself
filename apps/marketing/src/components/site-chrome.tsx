'use client';

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { SiteHeader, SampleDataBanner } from '@nestself/ui';
import type { Locale } from '@nestself/i18n';

export function SiteChrome({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  const { t } = useTranslation(['marketing', 'common']);
  const isDev = process.env.NODE_ENV === 'development';

  return (
    <>
      {isDev && (
        <SampleDataBanner message={t('common:sample.banner')} />
      )}
      <div className="mx-auto max-w-[1200px] px-4 @max-[599px]:px-4">
        <SiteHeader
          brand={{
            label: 'nestself',
            href: `/${locale}`,
          }}
          links={[
            { label: t('marketing:nav.findSupport'), href: '#support' },
            { label: t('marketing:nav.howItWorks'), href: '#how' },
            { label: t('marketing:nav.lifeBeyondWork'), href: '#life' },
            { label: t('marketing:nav.forEmployers'), href: '#employers' },
          ]}
          menuLabel={t('common:nav.openMenu')}
          closeLabel={t('common:nav.closeMenu')}
          className="text-[1.9rem] tracking-[-0.065em]"
        />
        {children}
      </div>
    </>
  );
}
