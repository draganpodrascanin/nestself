'use client';

import { useTranslation } from 'react-i18next';
import { Heading, Text, Table, Th, Td } from '@nestself/ui';
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
    <main id="main" tabIndex={-1}>
      <div className="py-16">
        <Heading level={1} typeRole="editorial">
          {t('marketing:pages.privacyModel.title')}
        </Heading>
        <Text typeRole="bodyLarge" tone="secondary" className="mt-4 max-w-[44rem]">
          {t('marketing:pages.privacyModel.lead')}
        </Text>
      </div>

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

      <p className="pb-16 type-metadata text-text-secondary">
        {t('marketing:privacy.disclaimer')}
      </p>
    </main>
  );
}
