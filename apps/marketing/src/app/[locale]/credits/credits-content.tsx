'use client';

import { useTranslation } from 'react-i18next';
import { Heading, Text, Table, Th, Td, TextLink } from '@nestself/ui';
import { photos } from '@nestself/assets';

export function CreditsPageContent() {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <main id="main" tabIndex={-1}>
      <div className="py-16">
        <Heading level={1} typeRole="editorial">
          {t('marketing:credits.title')}
        </Heading>
        <Text typeRole="bodyLarge" tone="secondary" className="mt-4 max-w-[44rem]">
          {t('marketing:credits.lead')}
        </Text>
      </div>

      <section id="photography" className="pb-12">
        <Heading level={2} typeRole="sectionTitle" className="mb-6">
          {t('marketing:credits.photographyHeading')}
        </Heading>
        <Table caption={t('marketing:credits.photographyCaption')} density="compact">
          <thead>
            <tr>
              <Th>{t('marketing:credits.colPhoto')}</Th>
              <Th>{t('marketing:credits.colPhotographer')}</Th>
              <Th>{t('marketing:credits.colSource')}</Th>
              <Th>{t('marketing:credits.colLicence')}</Th>
            </tr>
          </thead>
          <tbody>
            {photos.map((p) => (
              <tr key={p.key}>
                <Td>{p.key}</Td>
                <Td>{p.author}</Td>
                <Td>
                  <TextLink href={p.source}>Pexels</TextLink>
                </Td>
                <Td>
                  <TextLink href={p.license}>{t('marketing:credits.licence')}</TextLink>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="pb-12 border-t border-border-subtle pt-8">
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('marketing:credits.fontsHeading')}
        </Heading>
        <Text tone="secondary">
          {t('marketing:credits.fontsBody')}
        </Text>
      </section>

      <section className="pb-16 border-t border-border-subtle pt-8">
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {t('marketing:credits.iconsHeading')}
        </Heading>
        <Text tone="secondary">
          {t('marketing:credits.iconsBody')}
        </Text>
      </section>
    </main>
  );
}
