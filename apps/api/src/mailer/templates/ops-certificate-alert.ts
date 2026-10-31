/**
 * `ops_certificate_alert`: the nightly certificate check
 * (`MaintenanceJobsService`, spec 5.8) warns the operations mailbox
 * (`OPS_ALERT_EMAIL`) that a SAML connection's signing certificate expires
 * soon or has expired. The job sends it in English; the other locales exist
 * because every template has all four.
 */
import { composeMail, interpolate, link, paragraph, type MailLocale, type Messages, type RenderedMail } from './shared.js';

/** All values are text, as the job prints them: an ISO instant and whole days (zero or negative once expired). */
export interface OpsCertificateAlertData {
  organizationName: string;
  providerName: string;
  expiresAt: string;
  daysLeft: string;
  /** The staff SSO page where the connection is reviewed. */
  adminUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'reviewAction'> = {
  en: {
    subject: 'SSO certificate expiry notice: {{organizationName}}',
    body: 'The signing certificate of the SSO connection {{providerName}} ({{organizationName}}) expires on {{expiresAt}}. Days left: {{daysLeft}}.',
    reviewAction: 'Review the connection and ask the organization to renew the certificate',
  },
  'sr-Latn': {
    subject: 'Obaveštenje o isteku SSO sertifikata: {{organizationName}}',
    body: 'Sertifikat za potpisivanje SSO konekcije {{providerName}} ({{organizationName}}) ističe {{expiresAt}}. Preostalo dana: {{daysLeft}}.',
    reviewAction: 'Pregledajte konekciju i zatražite od organizacije da obnovi sertifikat',
  },
  'sr-Cyrl': {
    subject: 'Обавештење о истеку ССО сертификата: {{organizationName}}',
    body: 'Сертификат за потписивање ССО конекције {{providerName}} ({{organizationName}}) истиче {{expiresAt}}. Преостало дана: {{daysLeft}}.',
    reviewAction: 'Прегледајте конекцију и затражите од организације да обнови сертификат',
  },
  hu: {
    subject: 'Értesítés az SSO-tanúsítvány lejáratáról: {{organizationName}}',
    body: 'A(z) {{providerName}} SSO-kapcsolat ({{organizationName}}) aláíró tanúsítványa {{expiresAt}} napon lejár. Hátralévő napok: {{daysLeft}}.',
    reviewAction: 'Tekintse át a kapcsolatot, és kérje meg a szervezetet a tanúsítvány megújítására',
  },
};

export function render(locale: MailLocale, data: OpsCertificateAlertData): RenderedMail {
  const copy = messages[locale];
  const values = {
    organizationName: data.organizationName,
    providerName: data.providerName,
    expiresAt: data.expiresAt,
    daysLeft: data.daysLeft,
  };
  return composeMail(locale, interpolate(copy.subject, values), [
    paragraph(interpolate(copy.body, values)),
    link(copy.reviewAction, data.adminUrl),
  ]);
}
