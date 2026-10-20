import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { healthQueryOptions } from '@nestself/api-client';
import { Badge } from '@nestself/ui';
import { api } from '../api';

export function ApiStatus() {
  const { t } = useTranslation('workspace');
  const { data } = useQuery(healthQueryOptions(api));

  if (data?.status === 'ok') {
    return (
      <span className="flex items-center gap-2 type-metadata text-success">
        <span className="inline-block w-2 h-2 rounded-full bg-success" aria-hidden />
        {t('api.connected')}
      </span>
    );
  }

  return (
    <Badge tone="warning">
      {t('api.sampleMode')}
    </Badge>
  );
}
