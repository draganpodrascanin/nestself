'use client';

import { useTranslation } from 'react-i18next';
import { TextLink } from '@nestself/ui';
import { CreditsDialog } from '@/components/credits-dialog';
import { STORYBOOK_URL } from '@/lib/site';
import type { Locale } from '@nestself/i18n';

export function FooterSection({ locale }: { locale: Locale }) {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <footer className="py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-6 @max-[599px]:flex-col">
        <div>
          <span className="text-[1.9rem] tracking-[-0.065em] font-[var(--font-weight-label)] text-text">
            nestself
          </span>
          <p className="mt-1 type-metadata text-text-secondary">
            {t('common:brand.tagline')}
          </p>
        </div>
        <nav className="flex flex-wrap gap-6 type-body" aria-label={t('marketing:footer.navLabel')}>
          <TextLink href={`/${locale}/credits#photography`}>
            {t('marketing:footer.photography')}
          </TextLink>
          <CreditsDialog>
            {t('marketing:footer.credits')}
          </CreditsDialog>
          {STORYBOOK_URL ? (
            <TextLink href={STORYBOOK_URL}>
              {t('marketing:footer.designSystem')}
            </TextLink>
          ) : null}
        </nav>
      </div>
    </footer>
  );
}
