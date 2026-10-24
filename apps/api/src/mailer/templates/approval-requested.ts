/**
 * `appointment.approval.requested`: the approver, when a follow-up needs
 * manager approval (CALL-36, D-CW-37). Shows only the employee's display
 * name, "follow-up session with a NestSelf expert", the date and the
 * duration: never the service category, the expert or any content
 * (CW-R-123, LAW-14). No calendar file.
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

export interface ApprovalRequestedData {
  employeeDisplayName: string;
  appointment: Pick<AppointmentWindow, 'startsAt' | 'endsAt' | 'timeZone'>;
  /** The approval list in the approver's app. */
  approvalsUrl: string;
}

export const messages: Messages<'subject' | 'body' | 'decideAction'> = {
  en: {
    subject: 'A session approval is waiting for your decision',
    body: '{{employeeName}} has a follow-up session with a NestSelf expert on {{date}} at {{time}} ({{duration}} minutes). It needs your approval.',
    decideAction: 'Open NestSelf to decide',
  },
  'sr-Latn': {
    subject: 'Odobrenje sesije čeka vašu odluku',
    body: '{{employeeName}} ima narednu sesiju sa NestSelf stručnjakom {{date}} u {{time}} ({{duration}} min). Potrebno je vaše odobrenje.',
    decideAction: 'Otvorite NestSelf da biste odlučili',
  },
  'sr-Cyrl': {
    subject: 'Одобрење сесије чека вашу одлуку',
    body: '{{employeeName}} има наредну сесију са NestSelf стручњаком {{date}} у {{time}} ({{duration}} мин). Потребно је ваше одобрење.',
    decideAction: 'Отворите NestSelf да бисте одлучили',
  },
  hu: {
    subject: 'Egy alkalom jóváhagyása az Ön döntésére vár',
    body: '{{employeeName}} következő alkalma egy NestSelf szakértővel: {{date}}, {{time}} ({{duration}} perc). Az Ön jóváhagyására vár.',
    decideAction: 'Nyissa meg a NestSelf alkalmazást a döntéshez',
  },
};

export function render(locale: MailLocale, data: ApprovalRequestedData): RenderedMail {
  const copy = messages[locale];
  const body = interpolate(copy.body, {
    employeeName: data.employeeDisplayName,
    duration: String(durationMinutes(data.appointment)),
    ...whenValues(locale, data.appointment),
  });
  return composeMail(locale, copy.subject, [paragraph(body), link(copy.decideAction, data.approvalsUrl)]);
}
