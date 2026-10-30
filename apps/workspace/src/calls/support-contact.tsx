/**
 * The technical support contact shown where a call cannot go ahead (CALL-07
 * closed window, CALL-10 reconnect failed): a `mailto:` link to
 * `VITE_SUPPORT_EMAIL`. The default is a placeholder address on the reserved
 * `.example` domain; setting the real one is a launch checklist item
 * (docs/environment.md).
 */
import { useTranslation } from 'react-i18next';

export const SUPPORT_EMAIL_PLACEHOLDER = 'support@nestself.example';

export function supportEmail(): string {
  const configured = import.meta.env.VITE_SUPPORT_EMAIL?.trim();
  return configured ? configured : SUPPORT_EMAIL_PLACEHOLDER;
}

export function supportMailto(): string {
  return `mailto:${supportEmail()}`;
}

export function TechnicalSupportLink({ className }: { className?: string }) {
  const { t } = useTranslation('calls');
  const email = supportEmail();
  return (
    <a href={supportMailto()} className={className ?? 'text-primary underline underline-offset-[0.2em]'}>
      {t('support.technicalContact', { email })}
    </a>
  );
}
