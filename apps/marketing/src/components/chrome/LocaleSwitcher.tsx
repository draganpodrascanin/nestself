'use client';

import { usePathname } from 'next/navigation';
import { locales, localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useTranslation } from 'react-i18next';
import { cn } from '@nestself/ui';

export interface LocaleSwitcherProps {
  locale: Locale;
  className?: string;
}

/**
 * Lists the four supported locales as links. The current locale is
 * marked with `aria-current="true"`. On click each link sets the
 * `NEXT_LOCALE` cookie before navigation.
 */
export function LocaleSwitcher({ locale, className }: LocaleSwitcherProps) {
  const { t } = useTranslation(['marketing']);
  const pathname = usePathname();

  /** Replace the locale prefix in the current pathname. */
  function hrefFor(target: Locale): string {
    // pathname looks like /en/some-page or /sr-Latn/some-page
    const segments = pathname.split('/');
    // segments[0] is '', segments[1] is the locale
    segments[1] = target;
    return segments.join('/');
  }

  return (
    <nav
      aria-label={t('marketing:locale.switcherLabel')}
      className={cn('flex items-center gap-3', className)}
    >
      {locales.map((loc) => (
        <a
          key={loc}
          href={hrefFor(loc)}
          aria-current={loc === locale ? 'true' : undefined}
          onClick={() => {
            // Set the locale cookie before navigation
            globalThis.document.cookie = `NEXT_LOCALE=${loc};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
          }}
          className={cn(
            'type-label no-underline',
            loc === locale
              ? 'text-text font-[var(--font-weight-label)]'
              : 'text-text-secondary hover:text-primary hover:underline',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
        >
          {localeMeta[loc].nativeName}
        </a>
      ))}
    </nav>
  );
}
