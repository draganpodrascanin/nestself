'use client';

import { useTranslation } from 'react-i18next';
import { Heading, Text, LinkButton } from '@nestself/ui';

export default function NotFound() {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <main id="main" tabIndex={-1} className="py-20 text-center">
      <Heading level={1} typeRole="editorial">
        {t('marketing:notFound.title')}
      </Heading>
      <Text tone="secondary" className="mt-4 max-w-[44rem] mx-auto">
        {t('marketing:notFound.body')}
      </Text>
      <div className="mt-8">
        <LinkButton href="/">
          {t('marketing:notFound.cta')}
        </LinkButton>
      </div>
    </main>
  );
}
