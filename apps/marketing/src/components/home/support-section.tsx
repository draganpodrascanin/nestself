'use client';

import { useTranslation } from 'react-i18next';
import { ArrowRight } from '@phosphor-icons/react';
import { Eyebrow, Text, CategoryIcon, PhotoFigure } from '@nestself/ui';
import type { Locale } from '@nestself/i18n';

const areas = ['psychological', 'legal', 'financial'] as const;
const areaIcons = {
  psychological: 'mentalSupport',
  legal: 'legal',
  financial: 'financial',
} as const;

export function SupportSection({ locale }: { locale: Locale }) {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <section id="support" className="py-20 border-t border-border-subtle">
      <div className="grid grid-cols-[5fr_7fr] gap-16 @max-[760px]:grid-cols-1">
        <div>
          <Eyebrow>{t('marketing:support.eyebrow')}</Eyebrow>
          <h2 className="type-editorial mt-3">{t('marketing:support.title')}</h2>
          <Text typeRole="bodyLarge" tone="secondary" className="mt-4">
            {t('marketing:support.lead')}
          </Text>
          <PhotoFigure
            photo="friends-bench"
            alt={t('marketing:support.alt')}
            sizes="(max-width: 760px) 100vw, 42vw"
            className="mt-8 rounded-card overflow-hidden @max-[760px]:hidden"
          />
        </div>
        <div className="flex flex-col gap-8">
          <PhotoFigure
            photo="friends-bench"
            alt={t('marketing:support.alt')}
            sizes="100vw"
            className="rounded-card overflow-hidden hidden @max-[760px]:block"
          />
          {areas.map((area) => (
            <a
              key={area}
              href={`/${locale}/support#${area}`}
              className="group grid grid-cols-[40px_1fr_auto] items-start gap-4 no-underline text-text hover:text-primary"
            >
              <CategoryIcon
                category={areaIcons[area]}
                size={48}
                className="text-primary row-span-2 self-center"
              />
              <div>
                <h3 className="type-section-title group-hover:underline">
                  {t(`marketing:support.${area}.title`)}
                </h3>
                <Text tone="secondary" className="mt-1">
                  {t(`marketing:support.${area}.body`)}
                </Text>
              </div>
              <ArrowRight
                size={20}
                aria-hidden
                className="mt-1 text-primary opacity-0 group-hover:opacity-100 transition-opacity"
              />
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
