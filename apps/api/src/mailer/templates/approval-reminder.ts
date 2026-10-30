/**
 * `appointment.approval.reminder`: the approver and the alternate approver
 * when a follow-up approval is still undecided after 5 working days
 * (CALL-40, `appointment.approval.remind`). Same minimal content as the
 * request (CW-R-123). No calendar file.
 */
import {
  composeMail,
  durationMinutes,
  interpolate,
  link,
  paragraph,
  whenValues,
  type AppointmentWindow,
  type MailLocale,
  type Messages,
  type RenderedMail,
} from './shared.js';

export interface ApprovalReminderData {
  employeeDisplayName: string;
  appointment: Pick<AppointmentWindow, 'startsAt' | 'endsAt' | 'timeZone'>;
  approvalsUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'decideAction'> = {
  en: {
    subject: 'A session approval is still waiting',
    body: 'The follow-up session with a NestSelf expert for {{employeeName}} on {{date}} at {{time}} ({{duration}} minutes) is still waiting for your decision.',
    decideAction: 'Open NestSelf to decide',
  },
  'sr-Latn': {
    subject: 'Odobrenje sesije još uvek čeka',
    body: '{{employeeName}}: naredna sesija sa NestSelf stručnjakom {{date}} u {{time}} ({{duration}} min) još uvek čeka vašu odluku.',
    decideAction: 'Otvorite NestSelf da biste odlučili',
  },
  'sr-Cyrl': {
    subject: 'Одобрење сесије још увек чека',
    body: '{{employeeName}}: наредна сесија са NestSelf стручњаком {{date}} у {{time}} ({{duration}} мин) још увек чека вашу одлуку.',
    decideAction: 'Отворите NestSelf да бисте одлучили',
  },
  hu: {
    subject: 'Egy alkalom jóváhagyása még mindig vár',
    body: '{{employeeName}} következő alkalma egy NestSelf szakértővel ({{date}}, {{time}}, {{duration}} perc) még mindig az Ön döntésére vár.',
    decideAction: 'Nyissa meg a NestSelf alkalmazást a döntéshez',
  },
};

export function render(locale: MailLocale, data: ApprovalReminderData): RenderedMail {
  const copy = messages[locale];
  const body = interpolate(copy.body, {
    employeeName: data.employeeDisplayName,
    duration: String(durationMinutes(data.appointment)),
    ...whenValues(locale, data.appointment),
  });
  return composeMail(locale, copy.subject, [paragraph(body), link(copy.decideAction, data.approvalsUrl)]);
}
