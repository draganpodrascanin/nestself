import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Table, Th, Td, Badge } from '@nestself/ui';
import { SAMPLE_CONTENT } from '@nestself/sample-data';

function ContentPage() {
  const { t } = useTranslation(['admin', 'common']);

  return (
    <div>
      <Heading level={1}>{t('admin:content.title')}</Heading>
      <div className="mt-6">
        <Table caption={t('admin:content.title')}>
          <thead>
            <tr>
              <Th>{t('admin:experts.name')}</Th>
              <Th>{t('admin:content.area')}</Th>
              <Th>{t('admin:content.locale')}</Th>
            </tr>
          </thead>
          <tbody>
            {SAMPLE_CONTENT.map((article) => (
              <tr key={article.id}>
                <Td>
                  <div>
                    <span className="font-[var(--font-weight-label)]">{article.title}</span>
                    <p className="mt-1 type-metadata text-text-secondary">{article.summary}</p>
                  </div>
                </Td>
                <Td>
                  <Badge tone="neutral">{t(`common:area.${article.area}`)}</Badge>
                </Td>
                <Td>
                  <Badge tone="info">{article.locale}</Badge>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/content')({
  component: ContentPage,
});
