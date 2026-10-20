'use client';

import { useTranslation } from 'react-i18next';
import { Eyebrow, Text } from '@nestself/ui';

const steps = [1, 2, 3] as const;

export function HowSection() {
  const { t } = useTranslation(['marketing']);

  return (
    <section id="how" className="bg-canvas py-20">
      <Eyebrow>{t('marketing:how.eyebrow')}</Eyebrow>
      <h2 className="type-editorial mt-3">{t('marketing:how.title')}</h2>
      <Text typeRole="bodyLarge" tone="secondary" className="mt-4 max-w-[44rem]">
        {t('marketing:how.lead')}
      </Text>
      <div className="mt-12 grid grid-cols-3 gap-8 @max-[760px]:grid-cols-1">
        {steps.map((n) => (
          <article key={n} className="border-t border-border-control pt-6">
            <Eyebrow numbered className="tabular-nums">
              {String(n).padStart(2, '0')}
            </Eyebrow>
            <h3 className="type-section-title mt-3">
              {t(`marketing:how.step${n}.title`)}
            </h3>
            <Text tone="secondary" className="mt-2">
              {t(`marketing:how.step${n}.body`)}
            </Text>
          </article>
        ))}
      </div>
    </section>
  );
}
