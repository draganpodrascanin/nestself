'use client';

import { useTranslation } from 'react-i18next';
import { TextLink, Text } from '@nestself/ui';
import type { Locale } from '@nestself/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { localePath } from '@nestself/i18n';

export interface SiteFooterProps {
  locale: Locale;
}

interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

export function SiteFooter({ locale }: SiteFooterProps) {
  const { t } = useTranslation(['marketing', 'common']);

  const columns: FooterColumn[] = [
    {
      title: t('marketing:footer.product'),
      links: [
        { label: t('marketing:nav.services'), href: localePath(locale, '/services') },
        { label: t('marketing:nav.forEmployers'), href: localePath(locale, '/for-employers') },
        { label: t('marketing:nav.forEmployees'), href: localePath(locale, '/for-employees') },
        { label: t('marketing:footer.forManagers'), href: localePath(locale, '/for-managers') },
        { label: t('marketing:nav.plans'), href: localePath(locale, '/plans') },
      ],
    },
    {
      title: t('marketing:footer.resourcesCol'),
      links: [
        { label: t('marketing:footer.webinars'), href: localePath(locale, '/webinars') },
        { label: t('marketing:footer.articles'), href: localePath(locale, '/articles') },
        { label: t('marketing:footer.tools'), href: localePath(locale, '/tools') },
        { label: t('marketing:footer.faq'), href: localePath(locale, '/faq') },
        { label: t('marketing:footer.privacyModel'), href: localePath(locale, '/privacy-model') },
      ],
    },
    {
      title: t('marketing:footer.company'),
      links: [
        { label: t('marketing:nav.about'), href: localePath(locale, '/about') },
        { label: t('marketing:footer.demo'), href: localePath(locale, '/demo') },
        { label: t('marketing:footer.contact'), href: localePath(locale, '/contact') },
        { label: t('marketing:footer.accessibility'), href: localePath(locale, '/accessibility') },
      ],
    },
    {
      title: t('marketing:footer.legalCol'),
      links: [
        { label: t('marketing:footer.privacyPolicy'), href: localePath(locale, '/legal/privacy') },
        { label: t('marketing:footer.terms'), href: localePath(locale, '/legal/terms') },
        { label: t('marketing:footer.cookies'), href: localePath(locale, '/legal/cookies') },
        { label: t('marketing:footer.imprint'), href: localePath(locale, '/legal/imprint') },
      ],
    },
  ];

  return (
    <footer className="@container py-12 border-t border-border-subtle">
      <nav aria-label={t('marketing:footer.navLabel')}>
        <div className="gap-8 grid grid-cols-4 @max-[760px]:grid-cols-2 @max-[420px]:grid-cols-1">
          {columns.map((col) => (
            <div key={col.title}>
              <Text as="span" typeRole="label" className="mb-3 block">
                {col.title}
              </Text>
              <ul role="list" className="gap-1 min-w-0 flex flex-col">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <TextLink
                      href={link.href}
                      className="py-1 inline-block type-body break-words text-text-secondary"
                    >
                      {link.label}
                    </TextLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="mt-10 gap-6 pt-8 flex flex-wrap items-center justify-between border-t border-border-subtle @max-[760px]:flex-col @max-[760px]:items-start">
        <div>
          <span className="text-[1.9rem] font-[var(--font-weight-label)] tracking-[-0.065em] text-text">
            nestself
          </span>
          <Text typeRole="metadata" tone="secondary" className="mt-1">
            {t('marketing:footer.tagline')}
          </Text>
        </div>
        <LocaleSwitcher locale={locale} />
      </div>
    </footer>
  );
}
