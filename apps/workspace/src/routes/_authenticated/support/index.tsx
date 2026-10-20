import { createFileRoute, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Heading, Text, CategoryIcon } from '@nestself/ui';
import { supportAreas, supportAreaIcon } from '@nestself/contracts';
import type { SupportArea } from '@nestself/contracts';

export const Route = createFileRoute('/_authenticated/support/')({
  component: SupportIndexPage,
});

function SupportIndexPage() {
  const { t } = useTranslation(['workspace', 'common']);

  return (
    <div className="space-y-6">
      <Heading level={1} typeRole="screenTitle">
        {t('common:nav.support')}
      </Heading>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {supportAreas.map((area: SupportArea) => (
          <Link
            key={area}
            to="/support/$area"
            params={{ area }}
            className="flex flex-col items-center gap-3 p-6 rounded-card border border-border-subtle bg-surface hover:bg-tint transition-colors no-underline"
          >
            <CategoryIcon category={supportAreaIcon[area]} size={48} />
            <Text className="font-[var(--font-weight-label)] text-center">
              {t(`workspace:categories.${area}`)}
            </Text>
          </Link>
        ))}
      </div>
    </div>
  );
}
