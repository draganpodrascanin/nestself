/**
 * `appointment.approval.decided`: the employee, when the approver decides a
 * follow-up (CALL-39, guidelines 10.5). Approved: the join link and the
 * calendar file. Rejected: the approver's safe reason, if any, and no
 * calendar file. Expired (T-CW-1.10): nobody decided within ten working days,
 * so the follow-up is not booked; no reason and no calendar file.
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
  type MailEnvelope,
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
    }
  | {
      appointment: AppointmentWindow;
      decision: 'expired';
      appointmentUrl: string;
    };

export const messages: Messages<'subject' | 'approved' | 'rejected' | 'expired' | 'reason'> = {
  en: {
    subject: 'Your session approval has a decision',
    approved: 'Your follow-up session on {{date}} at {{time}} was approved.',
    rejected: 'Your follow-up session on {{date}} at {{time}} was not approved.',
    expired:
      'The approval of your follow-up session on {{date}} at {{time}} was not decided in time, so the session is not booked. You can ask your expert for a new proposal.',
    reason: 'Reason: {{reason}}',
  },
  'sr-Latn': {
    subject: 'Doneta je odluka o odobrenju vaše sesije',
    approved: 'Vaša naredna sesija {{date}} u {{time}} je odobrena.',
    rejected: 'Vaša naredna sesija {{date}} u {{time}} nije odobrena.',
    expired:
      'O odobrenju vaše naredne sesije {{date}} u {{time}} nije odlučeno na vreme, pa sesija nije zakazana. Možete zamoliti svog stručnjaka za novi predlog.',
    reason: 'Razlog: {{reason}}',
  },
  'sr-Cyrl': {
    subject: 'Донета је одлука о одобрењу ваше сесије',
    approved: 'Ваша наредна сесија {{date}} у {{time}} је одобрена.',
    rejected: 'Ваша наредна сесија {{date}} у {{time}} није одобрена.',
    expired:
      'О одобрењу ваше наредне сесије {{date}} у {{time}} није одлучено на време, па сесија није заказана. Можете замолити свог стручњака за нови предлог.',
    reason: 'Разлог: {{reason}}',
  },
  hu: {
    subject: 'Döntés született az alkalma jóváhagyásáról',
    approved: 'A következő alkalmát ({{date}}, {{time}}) jóváhagyták.',
    rejected: 'A következő alkalmát ({{date}}, {{time}}) nem hagyták jóvá.',
    expired:
      'A következő alkalma ({{date}}, {{time}}) jóváhagyásáról nem született döntés időben, ezért az alkalom nincs lefoglalva. Kérjen új javaslatot a szakértőjétől.',
    reason: 'Indoklás: {{reason}}',
  },
};

export function render(locale: MailLocale, data: ApprovalDecidedData, envelope: MailEnvelope): RenderedMail {
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
        calendarAttachment('nestself-session.ics', envelope, {
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

  if (data.decision === 'expired') {
    return composeMail(locale, copy.subject, [
      paragraph(interpolate(copy.expired, when)),
      link(shared.openAction, data.appointmentUrl),
    ]);
  }

  const reason = data.reason?.trim();
  const blocks: MailBlock[] = [paragraph(interpolate(copy.rejected, when))];
  if (reason) blocks.push(paragraph(interpolate(copy.reason, { reason })));
  blocks.push(link(shared.openAction, data.appointmentUrl));
  return composeMail(locale, copy.subject, blocks);
}
