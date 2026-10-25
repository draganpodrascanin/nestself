import { useTranslation } from 'react-i18next';
import { Alert, Heading, Text } from '@nestself/ui';
import type { OpsAdminApi } from '@nestself/api-client';
import { useOperationsContext } from '../access/use-ops-admin';
import { organizationErrorKey } from './organization-errors';
import { sampleOrganization } from './sample-organizations';
import { useOrganization } from './use-organizations';

export interface OrgHeadingProps {
  opsApi: OpsAdminApi;
  orgId: string;
  sampleMode: boolean;
}

/** The organization's name above its tabs, from `getOrganization` (or the sample). */
export function OrgHeading({ opsApi, orgId, sampleMode }: OrgHeadingProps) {
  const { t } = useTranslation(['admin', 'common']);
  const { ready, error: switchError } = useOperationsContext(sampleMode);
  const query = useOrganization(opsApi, ready ? orgId : null);

  if (sampleMode) {
    const org = sampleOrganization(orgId);
    return org ? (
      <Heading level={2} className="mt-6">
        {org.name}
      </Heading>
    ) : (
      <Alert tone="danger" title={t('admin:organizations.errors.loadTitle')} className="mt-6">
        {t('admin:organizations.errors.notFound')}
      </Alert>
    );
  }
  if (switchError) {
    return (
      <Alert tone="danger" title={t('admin:organizations.errors.loadTitle')} className="mt-6">
        {t(`admin:access.errors.${switchError}`)}
      </Alert>
    );
  }
  if (query.isError) {
    return (
      <Alert tone="danger" title={t('admin:organizations.errors.loadTitle')} className="mt-6">
        {t(`admin:organizations.errors.${organizationErrorKey(query.error)}`)}
      </Alert>
    );
  }
  if (!query.data) {
    return (
      <Text tone="secondary" className="mt-6">
        {t('admin:organizations.loading')}
      </Text>
    );
  }
  return (
    <Heading level={2} className="mt-6">
      {query.data.name}
    </Heading>
  );
}
