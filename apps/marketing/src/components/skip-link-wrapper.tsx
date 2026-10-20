'use client';

import { useTranslation } from 'react-i18next';
import { SkipLink } from '@nestself/ui';

export function SkipLinkWrapper() {
  const { t } = useTranslation(['common']);

  return <SkipLink href="#main">{t('common:nav.skipToContent')}</SkipLink>;
}
