'use client';

import type { ReactNode } from 'react';
import type { Locale } from '@nestself/i18n';
import { SiteHeaderBar } from '@/components/chrome/SiteHeaderBar';
import { SiteFooter } from '@/components/chrome/SiteFooter';

/**
 * Site chrome wrapper: header above `children`, footer below.
 * No SampleDataBanner -- the marketing site has no sample mode.
 */
export function SiteChrome({
  locale,
  children,
}: {
  locale: Locale;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-[1200px] px-4 @max-[599px]:px-4">
      <SiteHeaderBar locale={locale} />
      {children}
      <SiteFooter locale={locale} />
    </div>
  );
}
