'use client';

import { useTranslation } from 'react-i18next';
import { Eyebrow, Text, LinkButton, CoverageNotice, PhotoFigure } from '@nestself/ui';

export function HeroSection() {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <section aria-labelledby="home-title" className="py-16 pb-18">
      <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-12 @max-[760px]:grid-cols-1">
        <div className="flex flex-col justify-center gap-6">
          <Eyebrow>{t('marketing:hero.eyebrow')}</Eyebrow>
          <h1 id="home-title" className="type-marketing-hero">
            {t('marketing:hero.titleLine1')}
            <br />
            {t('marketing:hero.titleLine2')}
          </h1>
          <Text typeRole="bodyLarge" tone="secondary">
            {t('marketing:hero.lead')}
          </Text>
          <div className="flex flex-wrap gap-4">
            <LinkButton href="#support">
              {t('marketing:hero.ctaPrimary')}
            </LinkButton>
            <LinkButton
              href="#employers"
              className="border-border-control bg-surface text-primary hover:bg-tint"
            >
              {t('marketing:hero.ctaSecondary')}
            </LinkButton>
          </div>
          <CoverageNotice>{t('marketing:hero.note')}</CoverageNotice>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <PhotoFigure
            photo="family-grass"
            alt={t('marketing:hero.altLead')}
            imageRole="hero-3x2"
            sizes="(max-width: 760px) 100vw, 58vw"
            priority
            className="col-span-2 rounded-card overflow-hidden"
          />
          <PhotoFigure
            photo="friends-men"
            alt={t('marketing:hero.altFriends')}
            sizes="(max-width: 760px) 50vw, 29vw"
            className="rounded-card overflow-hidden aspect-[1.35] @max-[760px]:aspect-[1.35]"
          />
          <PhotoFigure
            photo="care-home"
            alt={t('marketing:hero.altCare')}
            sizes="(max-width: 760px) 50vw, 29vw"
            className="rounded-card overflow-hidden aspect-[1.35] @max-[760px]:aspect-[1.35]"
          />
        </div>
      </div>
      <p className="mt-6 type-metadata text-text-secondary">{t('marketing:hero.caption')}</p>
    </section>
  );
}
