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
}

export interface SiteHeaderProps {
  brand: SiteHeaderBrand;
  links: SiteHeaderLink[];
  actions?: ReactNode;
  menuLabel: string;
  closeLabel: string;
  className?: string;
}

export function SiteHeader({
  brand,
  links,
  actions,
  menuLabel,
  closeLabel,
  className,
}: SiteHeaderProps) {
  const [open, setOpen] = useState(false);
  const navId = 'site-nav';

  return (
    <header
      className={cn(
        'gap-8 py-6 @container flex flex-wrap items-center justify-between border-b border-border-subtle',
        'max-[760px]:gap-2 max-[760px]:py-4',
        className,
      )}
    >
      <a href={brand.href} className="font-[var(--font-weight-label)] text-text no-underline">
        {brand.label}
      </a>

      <button
        type="button"
        aria-expanded={open}
        aria-controls={navId}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          'min-h-11 min-w-11 pointer-coarse:min-h-12 pointer-coarse:min-w-12 hidden items-center justify-center rounded-control @max-[760px]:inline-flex',
          'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        )}
        aria-label={open ? closeLabel : menuLabel}
      >
        {open ? <X size={24} aria-hidden /> : <List size={24} aria-hidden />}
      </button>

      <nav
        id={navId}
        className={cn(
          'gap-8 flex items-center',
          '@max-[760px]:gap-1 @max-[760px]:pt-4 @max-[760px]:hidden @max-[760px]:flex-[0_0_100%] @max-[760px]:flex-col @max-[760px]:items-stretch',
          open && '@max-[760px]:flex',
        )}
      >
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            aria-current={link.current ? 'page' : undefined}
            className={cn(
              'type-body text-text no-underline hover:text-primary hover:underline',
              'min-h-11 @max-[760px]:px-3 @max-[760px]:min-h-12 flex items-center',
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
