'use client';

import { useTranslation } from 'react-i18next';
import { Eyebrow, Heading, Text, CategoryIcon, TextLink } from '@nestself/ui';
import { WORKSPACE_URL } from '@/lib/site';

const areas = ['psychological', 'legal', 'financial'] as const;
const areaIcons = {
  psychological: 'mentalSupport',
  legal: 'legal',
  financial: 'financial',
} as const;

export function SupportPageContent() {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <main id="main" tabIndex={-1}>
      <div className="py-16">
        <Eyebrow>{t('marketing:support.eyebrow')}</Eyebrow>
        <Heading level={1} typeRole="editorial" className="mt-3">
          {t('marketing:pages.support.title')}
        </Heading>
        <Text typeRole="bodyLarge" tone="secondary" className="mt-4 max-w-[44rem]">
          {t('marketing:pages.support.lead')}
        </Text>
      </div>

      <div className="space-y-16 pb-20">
        {areas.map((area) => (
          <section
            key={area}
            id={area}
            className="border-t border-border-subtle pt-8"
          >
            <div className="flex items-start gap-4">
              <CategoryIcon category={areaIcons[area]} size={48} className="text-primary shrink-0" />
              <div>
                <Heading level={2} typeRole="sectionTitle">
                  {t(`marketing:support.${area}.title`)}
                </Heading>
                <Text tone="secondary" className="mt-2 max-w-[52ch]">
                  {t(`marketing:support.${area}.body`)}
                </Text>
              </div>
            </div>
            <div className="mt-8 rounded-card bg-canvas p-8 text-center">
              <Text tone="secondary">
                {t('common:state.empty.title')}
              </Text>
              <Text typeRole="metadata" tone="secondary" className="mt-2">
                {t('common:state.empty.body')}
              </Text>
            </div>
          </section>
        ))}
      </div>

      <div className="border-t border-border-subtle py-8">
        <Text tone="secondary">
          {t('marketing:pages.support.workspaceNote')}{' '}
          <TextLink href={WORKSPACE_URL}>{t('marketing:pages.support.workspaceLink')}</TextLink>
        </Text>
      </div>
    </main>
  );
}
