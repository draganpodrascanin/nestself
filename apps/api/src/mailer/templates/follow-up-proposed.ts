/**
 * `appointment.follow_up.proposed`: the employee, when the expert proposes a
 * follow-up on the post-call screen (CALL-35, D-CW-37). Subject and body are
 * `calls.followUp.proposedEmailSubject` and `proposedEmailBody`. No calendar
 * file: nothing is confirmed yet.
 */
import {
  composeMail,
  interpolate,
  link,
  paragraph,
  sharedMessages,
  whenValues,
  type AppointmentWindow,
  type MailLocale,
  type Messages,
  type RenderedMail,
} from './shared.js';

export interface FollowUpProposedData {
  /** The proposed appointment (status `proposed`). */
  appointment: AppointmentWindow;
  /** The appointment page with Confirm, Suggest other times and Decline (CALL-42). */
  appointmentUrl: string;
}

export const messages: Messages<'subject' | 'body'> = {
  en: {
    subject: 'A follow-up was proposed',
    body: 'A follow-up session was proposed for {{date}} at {{time}}. Open NestSelf to confirm it, suggest other times or decline.',
  },
  'sr-Latn': {
    subject: 'Predložena je naredna sesija',
    body: 'Predložena je naredna sesija za {{date}} u {{time}}. Otvorite NestSelf da biste je potvrdili, predložili druge termine ili je odbili.',
  },
  'sr-Cyrl': {
    subject: 'Предложена је наредна сесија',
    body: 'Предложена је наредна сесија за {{date}} у {{time}}. Отворите NestSelf да бисте је потврдили, предложили друге термине или је одбили.',
  },
  hu: {
    subject: 'Következő alkalmat javasoltak',
    body: 'Következő alkalmat javasoltak erre az időpontra: {{date}}, {{time}}. Nyissa meg a NestSelf alkalmazást a megerősítéshez, más időpontok javaslásához vagy az elutasításhoz.',
  },
};

export function render(locale: MailLocale, data: FollowUpProposedData): RenderedMail {
  const copy = messages[locale];
  return composeMail(locale, copy.subject, [
    paragraph(interpolate(copy.body, whenValues(locale, data.appointment))),
    link(sharedMessages[locale].openAction, data.appointmentUrl),
  ]);
}
