import { useTranslation } from 'react-i18next';
import { Copy } from '@phosphor-icons/react';
import { IconButton, useToast } from '@nestself/ui';

export interface CopyValueProps {
  label: string;
  value: string;
}

/**
 * A labelled value (a DNS record, an entity ID, an ACS URL) shown as
 * selectable monospace text with a copy button. A refused clipboard write
 * says so in a toast, so the value can still be copied by hand.
 */
export function CopyValue({ label, value }: CopyValueProps) {
  const { t } = useTranslation('admin');
  const { add: addToast } = useToast();

  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(value);
      addToast({ title: t('sso.copy.done', { label }), tone: 'success' });
    } catch {
      addToast({ title: t('sso.copy.failed'), tone: 'danger' });
    }
  };

  return (
    <div className="space-y-1">
      <dt className="type-metadata text-text-secondary">{label}</dt>
      <dd className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-control bg-tint px-2 py-1 type-metadata text-text select-all">{value}</code>
        <IconButton
          size="sm"
          variant="ghost"
          label={t('sso.copy.label', { label })}
          icon={<Copy aria-hidden="true" />}
          onClick={() => void copy()}
        />
      </dd>
    </div>
  );
}
