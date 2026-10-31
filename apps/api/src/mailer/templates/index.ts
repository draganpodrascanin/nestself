/**
 * Template registry: `Mailer.send` is type-safe over `template` and `data`
 * because {@link MailInput} pairs each name with its own data type.
 *
 * Names follow the jobs and audit events of the decision record (section 7);
 * section 10 of the guidelines lists them with their recipients. The auth
 * templates (`step_up_code`, `sso_bind_code`, `ops_certificate_alert`) are
 * described in `docs/auth/implementation.md` section 23.
 */
import { type Locale } from '@nestself/contracts';
import * as appointmentCanceled from './appointment-canceled.js';
import * as appointmentNoShowFollowup from './appointment-no-show-followup.js';
import * as appointmentReminder from './appointment-reminder.js';
import * as approvalDecided from './approval-decided.js';
import * as approvalReminder from './approval-reminder.js';
import * as approvalRequested from './approval-requested.js';
import * as followUpConfirmed from './follow-up-confirmed.js';
import * as followUpDeclined from './follow-up-declined.js';
import * as followUpProposed from './follow-up-proposed.js';
import * as invitation from './invitation.js';
import * as opsCertificateAlert from './ops-certificate-alert.js';
import { type MailEnvelope, type RenderedMail } from './shared.js';
import * as ssoBindCode from './sso-bind-code.js';
import * as stepUpCode from './step-up-code.js';
import * as webinarCanceled from './webinar-canceled.js';
import * as webinarRecordedNotice from './webinar-recorded-notice.js';
import * as webinarRegistration from './webinar-registration.js';
import * as webinarReminder from './webinar-reminder.js';

export const mailTemplates = {
  'appointment.reminder': appointmentReminder,
  'appointment.canceled': appointmentCanceled,
  'appointment.no_show_followup': appointmentNoShowFollowup,
  'appointment.follow_up.proposed': followUpProposed,
  'appointment.follow_up.confirmed': followUpConfirmed,
  'appointment.follow_up.declined': followUpDeclined,
  'appointment.approval.requested': approvalRequested,
  'appointment.approval.reminder': approvalReminder,
  'appointment.approval.decided': approvalDecided,
  'webinar.registration': webinarRegistration,
  'webinar.reminder': webinarReminder,
  'webinar.canceled': webinarCanceled,
  'webinar.recorded_notice': webinarRecordedNotice,
  invitation,
  step_up_code: stepUpCode,
  sso_bind_code: ssoBindCode,
  ops_certificate_alert: opsCertificateAlert,
} as const;

export type MailTemplateName = keyof typeof mailTemplates;

export type MailTemplateData<T extends MailTemplateName> = Parameters<(typeof mailTemplates)[T]['render']>[1];

export const MAIL_TEMPLATE_NAMES = Object.keys(mailTemplates) as MailTemplateName[];

/** One email: recipient, locale, template name and that template's data. */
export type MailInput = {
  [T in MailTemplateName]: { to: string; locale: Locale; template: T; data: MailTemplateData<T> };
}[MailTemplateName];

/**
 * Renders subject, text, HTML and attachments for one email. `sender` is the
 * From address; calendar files name it as `ORGANIZER` and the recipient as
 * `ATTENDEE`.
 */
export function renderMail(input: MailInput, sender: string): RenderedMail {
  const template = mailTemplates[input.template] as {
    render: (locale: Locale, data: MailInput['data'], envelope: MailEnvelope) => RenderedMail;
  };
  return template.render(input.locale, input.data, { from: sender, to: input.to });
}

export { type MailAttachment, type MailEnvelope, type RenderedMail } from './shared.js';
