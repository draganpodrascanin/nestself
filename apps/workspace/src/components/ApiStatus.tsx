import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { healthQueryOptions } from '@nestself/api-client';
import { Badge } from '@nestself/ui';
import { api } from '../api';

export function ApiStatus() {
  const { t } = useTranslation('workspace');
  const { data } = useQuery({
    ...healthQueryOptions(api),
    // Only probe when an API URL is configured; sample mode must not depend on a backend.
    enabled: Boolean(import.meta.env.VITE_API_URL),
  });

  if (data?.status === 'ok') {
    return (
      <span className="gap-2 flex items-center type-metadata text-success">
        <span className="w-2 h-2 inline-block rounded-full bg-success" aria-hidden />
        {t('api.connected')}
      </span>
    );
  }

  return <Badge tone="warning">{t('api.sampleMode')}</Badge>;
}
