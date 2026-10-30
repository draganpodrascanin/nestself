/** The occurrence status as a badge (draft, published, live, ended, canceled). */
import { useTranslation } from 'react-i18next';
import { Badge } from '@nestself/ui';
import type { BadgeTone } from '@nestself/ui';
import type { WebinarStatus } from '@nestself/contracts';

const STATUS_TONE: Readonly<Record<WebinarStatus, BadgeTone>> = {
  draft: 'neutral',
  published: 'info',
  live: 'success',
  ended: 'neutral',
  canceled: 'warning',
};

export function WebinarStatusBadge({ status }: { status: WebinarStatus }) {
  const { t } = useTranslation('calls');
  return <Badge tone={STATUS_TONE[status]}>{t(`webinar.status.${status}`)}</Badge>;
}
