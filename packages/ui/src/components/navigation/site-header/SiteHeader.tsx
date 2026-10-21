'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { List, X } from '@phosphor-icons/react/dist/ssr';
import { cn } from '../../../lib/cn';

export interface SiteHeaderLink {
  label: string;
  href: string;
  current?: boolean;
}

export interface SiteHeaderBrand {
  label: string;
  href: string;
  /** Extra classes for the brand link only (size, tracking), so they never leak into the nav. */
  className?: string;
}

export interface SiteHeaderProps {
  brand: SiteHeaderBrand;
  links: SiteHeaderLink[];
  actions?: ReactNode;
  utilities?: ReactNode;
  menuLabel: string;
  closeLabel: string;
  className?: string;
}

export function SiteHeader({
  brand,
  links,
  actions,
  utilities,
  menuLabel,
  closeLabel,
  className,
}: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const navId = 'site-nav';

  return (
    <header
      className={cn(
        'gap-4 py-6 @container flex flex-wrap items-center border-b border-border-subtle',
        '@max-[1000px]:gap-2 @max-[1000px]:py-4',
        className,
      )}
    >
      <a
        href={brand.href}
        className={cn('font-[var(--font-weight-label)] text-text no-underline', brand.className)}
      >
        {brand.label}
      </a>

      <div className="ml-auto flex items-center gap-1 @min-[1001px]:order-1">
        {utilities}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={navId}
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            'min-h-11 min-w-11 pointer-coarse:min-h-12 pointer-coarse:min-w-12 hidden items-center justify-center rounded-control @max-[1000px]:inline-flex',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
          )}
          aria-label={open ? closeLabel : menuLabel}
        >
          {open ? <X size={24} aria-hidden /> : <List size={24} aria-hidden />}
        </button>
      </div>

      <nav
        id={navId}
        className={cn(
          'gap-4 flex items-center ml-auto',
          '@max-[1000px]:gap-1 @max-[1000px]:pt-4 @max-[1000px]:hidden @max-[1000px]:flex-[0_0_100%] @max-[1000px]:flex-col @max-[1000px]:items-stretch',
          open && '@max-[1000px]:flex',
        )}
      >
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={link.current ? 'page' : undefined}
            className={cn(
              'text-[0.9375rem] text-text no-underline hover:text-primary hover:underline',
              'min-h-11 @max-[1000px]:px-3 @max-[1000px]:min-h-12 flex items-center',
              'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
            )}
          >
            {link.label}
          </a>
        ))}
        {actions}
      </nav>
    </header>
  );
}
