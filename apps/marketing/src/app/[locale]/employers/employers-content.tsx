'use client';

import { useTranslation } from 'react-i18next';
import { Eyebrow, Heading, Text, PhotoFigure } from '@nestself/ui';

export function EmployersPageContent() {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <main id="main" tabIndex={-1}>
      <div className="py-16">
        <Eyebrow>{t('marketing:employer.eyebrow')}</Eyebrow>
        <Heading level={1} typeRole="editorial" className="mt-3">
          {t('marketing:pages.employers.title')}
        </Heading>
        <Text typeRole="bodyLarge" tone="secondary" className="mt-4 max-w-[44rem]">
          {t('marketing:pages.employers.lead')}
        </Text>
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-12 pb-16 @max-[760px]:grid-cols-1">
        <div>
          <Text className="max-w-[52ch]">
            {t('marketing:employer.body')}
          </Text>

          <div className="mt-12 space-y-6 border-t border-border-subtle pt-8">
            <Heading level={2} typeRole="sectionTitle">
              {t('marketing:pages.employers.hrTitle')}
            </Heading>
            <ul className="space-y-4 list-disc pl-5">
              <li>
                <Text tone="secondary">
                  {t('marketing:pages.employers.hrAggregates')}
                </Text>
              </li>
              <li>
                <Text tone="secondary">
                  {t('marketing:pages.employers.hrProtected')}
                </Text>
              </li>
              <li>
                <Text tone="secondary">
                  {t('marketing:pages.employers.hrRoles')}
                </Text>
              </li>
            </ul>
          </div>
        </div>
        <PhotoFigure
          photo="family-autumn"
          alt={t('marketing:employer.alt')}
          sizes="(max-width: 760px) 100vw, 50vw"
          className="rounded-card overflow-hidden"
        />
      </div>
    </main>
  );
}
