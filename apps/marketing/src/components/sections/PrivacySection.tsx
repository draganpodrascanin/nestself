'use client';

import { useTranslation } from 'react-i18next';
import { LockKey } from '@phosphor-icons/react/dist/ssr';
import { Button, Text, Dialog, DialogTrigger, DialogContent, TextLink } from '@nestself/ui';
import type { Locale } from '@nestself/i18n';

export function PrivacySection({ locale }: { locale: Locale }) {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <div className="gap-6 py-12 @max-[599px]:gap-4 grid grid-cols-[auto_1fr_auto] items-start border-b border-border-subtle @max-[599px]:grid-cols-1">
      <LockKey size={32} weight="duotone" aria-hidden className="mt-1 text-primary" />
      <div>
        <h2 className="type-section-title">{t('marketing:privacy.title')}</h2>
        <Text tone="secondary" className="mt-2">
          {t('marketing:privacy.body')}
        </Text>
      </div>
      <Dialog>
        <DialogTrigger>
          <Button variant="secondary" size="sm" data-testid="privacy-trigger">
            {t('marketing:privacy.cta')}
          </Button>
        </DialogTrigger>
        <DialogContent
          title={t('marketing:privacy.dialogTitle')}
          description={t('marketing:privacy.dialogLead')}
          closeLabel={t('common:nav.close')}
        >
          <ul className="space-y-4 mt-4">
            <li className="type-body text-text-secondary">
              {t('marketing:privacy.rows.employee')}
            </li>
            <li className="type-body text-text-secondary">{t('marketing:privacy.rows.advisor')}</li>
            <li className="type-body text-text-secondary">
              {t('marketing:privacy.rows.employer')}
            </li>
            <li className="type-body text-text-secondary">
              {t('marketing:privacy.rows.exceptional')}
            </li>
          </ul>
          <p className="mt-6 type-metadata text-text-secondary">
            {t('marketing:privacy.disclaimer')}
          </p>
          <div className="mt-4">
            <TextLink href={`/${locale}/privacy-model`}>{t('marketing:privacy.cta')}</TextLink>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
