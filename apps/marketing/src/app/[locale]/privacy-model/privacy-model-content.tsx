'use client';

import { useTranslation } from 'react-i18next';
import { Heading, Card, Table, Th, Td } from '@nestself/ui';
import { accessModel } from '@nestself/contracts';

/** Maps each English `data` value from the contract to its i18n row key. */
const ROW_KEYS: Record<string, string> = {
  'Conversation content': 'conversationContent',
  'Appointments / support history': 'appointmentsHistory',
  'Benefit eligibility': 'benefitEligibility',
  'Company fund': 'companyFund',
  'Usage reporting': 'usageReporting',
};

export function PrivacyModelContent() {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <section aria-labelledby="access-matrix-title" className="pb-8">
      <Heading level={2} id="access-matrix-title" typeRole="sectionTitle" className="mb-6">
        {t('marketing:pages.privacyModel.caption')}
      </Heading>

      {/* Wide: table layout */}
      <div className="@max-[760px]:hidden">
        <Table caption={t('marketing:pages.privacyModel.caption')} className="mb-8">
          <thead>
            <tr>
              <Th>{t('marketing:pages.privacyModel.colData')}</Th>
              <Th>{t('marketing:pages.privacyModel.colEmployee')}</Th>
              <Th>{t('marketing:pages.privacyModel.colAdvisor')}</Th>
              <Th>{t('marketing:pages.privacyModel.colHr')}</Th>
              <Th>{t('marketing:pages.privacyModel.colOperations')}</Th>
            </tr>
          </thead>
          <tbody>
            {accessModel.rows.map((row) => {
              const rowKey = ROW_KEYS[row.data];
              const prefix = `marketing:pages.privacyModel.rows.${rowKey}`;
              return (
                <tr key={row.data}>
                  <Td className="font-[var(--font-weight-label)]">{t(`${prefix}.data`)}</Td>
                  <Td>{t(`${prefix}.employee`)}</Td>
                  <Td>{t(`${prefix}.advisor`)}</Td>
                  <Td>{t(`${prefix}.hr`)}</Td>
                  <Td>{t(`${prefix}.operations`)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </div>

      {/* Phone: card layout */}
      <div className="hidden @max-[760px]:flex flex-col gap-4 mb-8">
        {accessModel.rows.map((row) => {
          const rowKey = ROW_KEYS[row.data];
          const prefix = `marketing:pages.privacyModel.rows.${rowKey}`;
          return (
            <Card key={row.data} padding="md" className="flex flex-col gap-3">
              <Heading level={3} typeRole="sectionTitle">
                {t(`${prefix}.data`)}
              </Heading>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <dt className="type-metadata text-text-secondary">{t('marketing:pages.privacyModel.colEmployee')}</dt>
                <dd className="type-metadata text-text">{t(`${prefix}.employee`)}</dd>
                <dt className="type-metadata text-text-secondary">{t('marketing:pages.privacyModel.colAdvisor')}</dt>
                <dd className="type-metadata text-text">{t(`${prefix}.advisor`)}</dd>
                <dt className="type-metadata text-text-secondary">{t('marketing:pages.privacyModel.colHr')}</dt>
                <dd className="type-metadata text-text">{t(`${prefix}.hr`)}</dd>
                <dt className="type-metadata text-text-secondary">{t('marketing:pages.privacyModel.colOperations')}</dt>
                <dd className="type-metadata text-text">{t(`${prefix}.operations`)}</dd>
              </dl>
            </Card>
          );
        })}
      </div>

      <p className="pb-8 type-metadata text-text-secondary">
        {t('marketing:privacy.disclaimer')}
      </p>
    </section>
  );
}
