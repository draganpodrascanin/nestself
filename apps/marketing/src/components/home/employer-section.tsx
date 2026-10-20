'use client';

import { useTranslation } from 'react-i18next';
import { Eyebrow, Text, LinkButton, PhotoFigure } from '@nestself/ui';
import type { Locale } from '@nestself/i18n';

export function EmployerSection({ locale }: { locale: Locale }) {
  const { t } = useTranslation(['marketing']);

  return (
    <section id="employers" className="py-16 -mx-4 px-4 bg-primary text-on-primary">
      <div className="gap-12 mx-auto grid max-w-[1200px] grid-cols-[1fr_1fr] items-center @max-[760px]:grid-cols-1">
        <div>
          <Eyebrow className="text-on-primary opacity-80">
            {t('marketing:employer.eyebrow')}
          </Eyebrow>
          <h2 className="mt-3 type-editorial text-on-primary">{t('marketing:employer.title')}</h2>
          <Text className="mt-4 text-on-primary opacity-90">{t('marketing:employer.body')}</Text>
          <div className="mt-6">
            <LinkButton href={`/${locale}/employers`} variant="on-brand">
              {t('marketing:employer.cta')}
            </LinkButton>
          </div>
        </div>
        <PhotoFigure
          photo="family-autumn"
          alt={t('marketing:employer.alt')}
          sizes="(max-width: 760px) 100vw, 50vw"
          className="overflow-hidden rounded-card"
        />
      </div>
    </section>
  );
}
