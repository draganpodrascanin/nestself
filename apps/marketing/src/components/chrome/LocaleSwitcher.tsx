'use client';

import { usePathname } from 'next/navigation';
import { locales, localeMeta, localePath, stripLocalePrefix } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { useTranslation } from 'react-i18next';
import { Globe, CaretDown } from '@phosphor-icons/react/dist/ssr';
import { Menu, MenuTrigger, MenuPopup, MenuLinkItem, VisuallyHidden } from '@nestself/ui';

export interface LocaleSwitcherProps {
  locale: Locale;
  className?: string;
}

/** Set the NEXT_LOCALE cookie (module-level to avoid the immutability lint). */
function writeLocaleCookie(loc: Locale) {
  document.cookie = `NEXT_LOCALE=${loc};path=/;max-age=${365 * 24 * 60 * 60};samesite=lax`;
}

/**
 * Dropdown menu listing the four supported locales. The current locale
 * is marked with `aria-current="true"` and a check icon. On click each
 * item sets the `NEXT_LOCALE` cookie before navigation.
 */
export function LocaleSwitcher({ locale, className }: LocaleSwitcherProps) {
  const { t } = useTranslation(['marketing']);
  const pathname = usePathname();

  /** The same page in another locale: Serbian Latin at the root, every other locale prefixed. */
  function hrefFor(target: Locale): string {
    return localePath(target, stripLocalePrefix(pathname).path);
  }

  const label = t('marketing:locale.switcherLabel');

  return (
    <div className={className}>
      <Menu>
        <MenuTrigger variant="quiet">
          <Globe weight="regular" size={20} aria-hidden />
          <VisuallyHidden>{label}: </VisuallyHidden>
          {localeMeta[locale].nativeName}
          <CaretDown size={14} aria-hidden />
        </MenuTrigger>
        <MenuPopup aria-label={label}>
          {locales.map((loc) => {
            const meta = localeMeta[loc];
            return (
              <MenuLinkItem
                key={loc}
                href={hrefFor(loc)}
                current={loc === locale}
                onClick={() => writeLocaleCookie(loc)}
              >
                <span lang={meta.htmlLang}>
                  {meta.nativeName}
                  {meta.scriptLabel && (
                    <span className="text-text-secondary type-metadata">
                      {' '}&middot; {meta.scriptLabel}
                    </span>
                  )}
                </span>
              </MenuLinkItem>
            );
          })}
        </MenuPopup>
      </Menu>
    </div>
  );
}
