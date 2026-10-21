'use client';

import { useTranslation } from 'react-i18next';
import { TextLink, Text } from '@nestself/ui';
import type { Locale } from '@nestself/i18n';
import { LocaleSwitcher } from './LocaleSwitcher';
import { CreditsDialog } from '@/components/credits-dialog';

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
        { label: t('marketing:nav.services'), href: `/${locale}/services` },
        { label: t('marketing:nav.forEmployers'), href: `/${locale}/for-employers` },
        { label: t('marketing:nav.forEmployees'), href: `/${locale}/for-employees` },
        { label: t('marketing:footer.forManagers'), href: `/${locale}/for-managers` },
        { label: t('marketing:nav.plans'), href: `/${locale}/plans` },
      ],
    },
    {
      title: t('marketing:footer.resourcesCol'),
      links: [
        { label: t('marketing:footer.webinars'), href: `/${locale}/webinars` },
        { label: t('marketing:footer.articles'), href: `/${locale}/articles` },
        { label: t('marketing:footer.tools'), href: `/${locale}/tools` },
        { label: t('marketing:footer.faq'), href: `/${locale}/faq` },
        { label: t('marketing:footer.privacyModel'), href: `/${locale}/privacy-model` },
      ],
    },
    {
      title: t('marketing:footer.company'),
      links: [
        { label: t('marketing:nav.about'), href: `/${locale}/about` },
        { label: t('marketing:footer.demo'), href: `/${locale}/demo` },
        { label: t('marketing:footer.contact'), href: `/${locale}/contact` },
        { label: t('marketing:footer.accessibility'), href: `/${locale}/accessibility` },
        { label: t('marketing:footer.creditsPage'), href: `/${locale}/credits` },
      ],
    },
    {
      title: t('marketing:footer.legalCol'),
      links: [
        { label: t('marketing:footer.privacyPolicy'), href: `/${locale}/legal/privacy` },
        { label: t('marketing:footer.terms'), href: `/${locale}/legal/terms` },
        { label: t('marketing:footer.cookies'), href: `/${locale}/legal/cookies` },
        { label: t('marketing:footer.imprint'), href: `/${locale}/legal/imprint` },
      ],
    },
  ];

  return (
    <footer className="py-12 border-t border-border-subtle">
      <nav aria-label={t('marketing:footer.navLabel')}>
        <div className="grid gap-8 grid-cols-4 @max-[760px]:grid-cols-2">
          {columns.map((col) => (
            <div key={col.title}>
              <Text as="span" typeRole="label" className="mb-3 block">
                {col.title}
              </Text>
              <ul role="list" className="flex flex-col gap-2">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <TextLink href={link.href} className="type-body text-text-secondary">
                      {link.label}
                    </TextLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-6 border-t border-border-subtle pt-8 @max-[760px]:flex-col @max-[760px]:items-start">
        <div>
          <span className="text-[1.9rem] tracking-[-0.065em] font-[var(--font-weight-label)] text-text">
            nestself
          </span>
          <Text typeRole="metadata" tone="secondary" className="mt-1">
            {t('marketing:footer.tagline')}
          </Text>
        </div>
        <div className="flex flex-wrap items-center gap-6 @max-[760px]:flex-col @max-[760px]:items-start @max-[760px]:gap-4">
          <LocaleSwitcher locale={locale} />
          <CreditsDialog>
            {t('marketing:footer.credits')}
          </CreditsDialog>
        </div>
      </div>
    </footer>
  );
}
