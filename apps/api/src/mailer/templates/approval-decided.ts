/**
 * `appointment.approval.decided`: the employee, when the approver decides a
 * follow-up (CALL-39, guidelines 10.5). Approved: the join link and the
 * calendar file. Rejected: the approver's safe reason, if any, and no
 * calendar file.
 */
import { icsUid } from '../../calendar/ics-generator.js';
import {
  calendarAttachment,
  composeMail,
  interpolate,
  link,
  paragraph,
  sharedMessages,
  whenValues,
  type AppointmentWindow,
  type MailBlock,
  type MailLocale,
  type Messages,
  type RenderedMail,
} from './shared.js';

export type ApprovalDecidedData =
  | {
      appointment: AppointmentWindow;
      decision: 'approved';
      /** Authenticated link to the appointment page. */
      joinUrl: string;
      sequence?: number;
    }
  | {
      appointment: AppointmentWindow;
      decision: 'rejected';
      /** The approver's safe reason (CW-R-109), shown as written. */
      reason?: string | null;
      appointmentUrl: string;
    };

export const messages: Messages<'subject' | 'approved' | 'rejected' | 'reason'> = {
  en: {
    subject: 'Your session approval has a decision',
    approved: 'Your follow-up session on {{date}} at {{time}} was approved.',
    rejected: 'Your follow-up session on {{date}} at {{time}} was not approved.',
    reason: 'Reason: {{reason}}',
  },
  'sr-Latn': {
    subject: 'Doneta je odluka o odobrenju vaše sesije',
    approved: 'Vaša naredna sesija {{date}} u {{time}} je odobrena.',
    rejected: 'Vaša naredna sesija {{date}} u {{time}} nije odobrena.',
    reason: 'Razlog: {{reason}}',
  },
  'sr-Cyrl': {
    subject: 'Донета је одлука о одобрењу ваше сесије',
    approved: 'Ваша наредна сесија {{date}} у {{time}} је одобрена.',
    rejected: 'Ваша наредна сесија {{date}} у {{time}} није одобрена.',
    reason: 'Разлог: {{reason}}',
  },
  hu: {
    subject: 'Döntés született az alkalma jóváhagyásáról',
    approved: 'A következő alkalmát ({{date}}, {{time}}) jóváhagyták.',
    rejected: 'A következő alkalmát ({{date}}, {{time}}) nem hagyták jóvá.',
    reason: 'Indoklás: {{reason}}',
  },
};

export function render(locale: MailLocale, data: ApprovalDecidedData): RenderedMail {
  const copy = messages[locale];
  const shared = sharedMessages[locale];
  const { appointment } = data;
  const when = whenValues(locale, appointment);

  if (data.decision === 'approved') {
    return composeMail(
      locale,
      copy.subject,
      [paragraph(interpolate(copy.approved, when)), link(shared.joinAction, data.joinUrl)],
      [
        calendarAttachment('nestself-session.ics', {
          method: 'REQUEST',
          uid: icsUid('appointment', appointment.id),
          summary: shared.sessionSummary,
          description: interpolate(shared.joinDescription, { url: data.joinUrl }),
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          timeZone: appointment.timeZone,
          sequence: data.sequence,
        }),
      ],
    );
  }

  const reason = data.reason?.trim();
  const blocks: MailBlock[] = [paragraph(interpolate(copy.rejected, when))];
  if (reason) blocks.push(paragraph(interpolate(copy.reason, { reason })));
  blocks.push(link(shared.openAction, data.appointmentUrl));
  return composeMail(locale, copy.subject, blocks);
}
