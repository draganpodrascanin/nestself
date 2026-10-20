import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Table, Th, Td, Badge } from '@nestself/ui';
import { SAMPLE_ORG } from '@nestself/sample-data';

function OrganizationsPage() {
  const { t } = useTranslation('admin');

  return (
    <div>
      <Heading level={1}>{t('organizations.title')}</Heading>
      <div className="mt-6">
        <Table caption={t('organizations.title')}>
          <thead>
            <tr>
              <Th>{t('organizations.name')}</Th>
              <Th>{t('organizations.status')}</Th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <Td>
                <Link
                  to="/organizations/$orgId"
                  params={{ orgId: SAMPLE_ORG.id }}
                  className="no-underline text-primary"
                >
                  {SAMPLE_ORG.name}
                </Link>
              </Td>
              <Td>
                <Badge tone="success">{t('organizations.active')}</Badge>
              </Td>
            </tr>
          </tbody>
        </Table>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/organizations/')({
  component: OrganizationsPage,
});
