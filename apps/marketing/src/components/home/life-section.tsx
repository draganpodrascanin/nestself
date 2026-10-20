'use client';

import { useTranslation } from 'react-i18next';
import { Eyebrow, Text, PhotoFigure } from '@nestself/ui';

export function LifeSection() {
  const { t } = useTranslation(['marketing']);

  return (
    <section id="life" className="py-22">
      <div className="max-w-[44rem]">
        <Eyebrow>{t('marketing:life.eyebrow')}</Eyebrow>
        <h2 className="type-editorial mt-3">{t('marketing:life.title')}</h2>
        <Text typeRole="bodyLarge" tone="secondary" className="mt-4">
          {t('marketing:life.lead')}
        </Text>
      </div>
      <div className="mt-12 grid grid-cols-[5fr_3fr_4fr] gap-4 @max-[760px]:grid-cols-1">
        <PhotoFigure
          photo="grandfather"
          alt={t('marketing:life.alt1')}
          sizes="(max-width: 760px) 100vw, 42vw"
          caption={t('marketing:life.caption1')}
          className="rounded-card overflow-hidden"
        />
        <PhotoFigure
          photo="family-play"
          alt={t('marketing:life.alt2')}
          imageRole="portrait"
          sizes="(max-width: 760px) 100vw, 25vw"
          caption={t('marketing:life.caption2')}
          className="rounded-card overflow-hidden"
        />
        <PhotoFigure
          photo="couple-cooking"
          alt={t('marketing:life.alt3')}
          sizes="(max-width: 760px) 100vw, 33vw"
          caption={t('marketing:life.caption3')}
          className="rounded-card overflow-hidden"
        />
      </div>
    </section>
  );
}
