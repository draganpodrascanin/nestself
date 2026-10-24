/**
 * Generalised mailer (T-CW-1.3): four-locale neutral templates, the ICS
 * attachments, the SES raw MIME message, the logging mailer and the module
 * factory (D-CW-26, D-CW-37, CW-R-42, CW-R-43, CW-R-44, CW-R-123).
 */
import { SendRawEmailCommand, SESClient, type SendRawEmailCommandInput } from '@aws-sdk/client-ses';
import { Logger } from '@nestjs/common';
import { locales, type Locale } from '@nestself/contracts';
import { mockClient } from 'aws-sdk-client-mock';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ICS_UID_DOMAIN } from '../calendar/ics-generator.js';
import { LoggingMailer } from './logging-mailer.js';
import { renderMail, type MailInput } from './mailer.js';
import { createMailer, sesMailerOptions } from './mailer.module.js';
import { SesMailer } from './ses-mailer.js';
import { sharedMessages } from './templates/shared.js';
import {
  MAIL_TEMPLATE_NAMES,
  mailTemplates,
  type MailTemplateData,
  type MailTemplateName,
} from './templates/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const APPOINTMENT = {
  id: 'appt-1',
  startsAt: '2026-11-02T09:00:00.000Z',
  endsAt: '2026-11-02T09:50:00.000Z',
  timeZone: 'Europe/Belgrade',
};
const WEBINAR = {
  startsAt: '2026-11-05T16:00:00.000Z',
  endsAt: '2026-11-05T17:00:00.000Z',
  timeZone: 'Europe/Belgrade',
};
const JOIN_URL = 'https://app.nestself.rs/appointments/appt-1';
const APPOINTMENT_URL = 'https://app.nestself.rs/appointments/appt-1';

/** One valid data object per template; the mapped type fails to compile when a template is missing. */
const samples: { [T in MailTemplateName]: MailTemplateData<T> } = {
  'appointment.reminder': { appointment: APPOINTMENT, joinUrl: JOIN_URL },
  'appointment.canceled': { appointment: APPOINTMENT, appointmentUrl: APPOINTMENT_URL },
  'appointment.no_show_followup': {
    appointment: APPOINTMENT,
    reportProblemUrl: 'https://app.nestself.rs/support/new?appointment=appt-1',
    bookingUrl: 'https://app.nestself.rs/appointments',
  },
  'appointment.follow_up.proposed': { appointment: APPOINTMENT, appointmentUrl: APPOINTMENT_URL },
  'appointment.follow_up.confirmed': { appointment: APPOINTMENT, joinUrl: JOIN_URL },
  'appointment.follow_up.declined': {
    appointment: APPOINTMENT,
    appointmentUrl: 'https://admin.nestself.rs/consultations/appt-1',
  },
  'appointment.approval.requested': {
    employeeDisplayName: 'Mila Sample',
    appointment: APPOINTMENT,
    approvalsUrl: 'https://admin.nestself.rs/approvals',
  },
  'appointment.approval.reminder': {
    employeeDisplayName: 'Mila Sample',
    appointment: APPOINTMENT,
    approvalsUrl: 'https://admin.nestself.rs/approvals',
  },
  'appointment.approval.decided': { appointment: APPOINTMENT, decision: 'approved', joinUrl: JOIN_URL },
  'webinar.registration': {
    registrationId: 'reg-1',
    webinar: WEBINAR,
    joinUrl: 'https://app.nestself.rs/webinars/web-1',
  },
  'webinar.reminder': {
    registrationId: 'reg-1',
    webinar: WEBINAR,
    joinUrl: 'https://app.nestself.rs/webinars/web-1',
  },
  'webinar.canceled': {
    registrationId: 'reg-1',
    webinar: WEBINAR,
    webinarsUrl: 'https://app.nestself.rs/webinars',
  },
  'webinar.recorded_notice': {
    webinar: WEBINAR,
    reviewUrl: 'https://admin.nestself.rs/webinars/web-1/recording',
  },
  invitation: {
    organizationName: 'Example d.o.o.',
    inviterDisplayName: 'Ivana',
    activationUrl: 'https://app.nestself.rs/invitations/tok_123',
  },
};

function input<T extends MailTemplateName>(template: T, locale: Locale = 'en', to = 'mila@example.test'): MailInput {
  return { to, locale, template, data: samples[template] } as MailInput;
}

const cases = MAIL_TEMPLATE_NAMES.flatMap((template) => locales.map((locale) => [template, locale] as const));

// ---------------------------------------------------------------------------
// Registry and copy
// ---------------------------------------------------------------------------

describe('mail templates', () => {
  it('registers every template section 10 and the stories name', () => {
    expect([...MAIL_TEMPLATE_NAMES].sort()).toEqual(
      [
        'appointment.approval.decided',
        'appointment.approval.reminder',
        'appointment.approval.requested',
        'appointment.canceled',
        'appointment.follow_up.confirmed',
        'appointment.follow_up.declined',
        'appointment.follow_up.proposed',
        'appointment.no_show_followup',
        'appointment.reminder',
        'invitation',
        'webinar.canceled',
        'webinar.recorded_notice',
        'webinar.registration',
        'webinar.reminder',
      ].sort(),
    );
  });

  const catalogs: [string, Record<Locale, Record<string, string>>][] = [
    ['shared', sharedMessages],
    ...MAIL_TEMPLATE_NAMES.map(
      (name) => [name, mailTemplates[name].messages as Record<Locale, Record<string, string>>] as [
        string,
        Record<Locale, Record<string, string>>,
      ],
    ),
  ];

  const placeholders = (value: string): string[] => [...value.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]!).sort();

  it.each(catalogs)('%s has the same keys and placeholders in all four locales (CW-R-42)', (_name, messages) => {
    expect(Object.keys(messages).sort()).toEqual([...locales].sort());
    const reference = messages.en;
    for (const locale of locales) {
      expect(Object.keys(messages[locale]).sort()).toEqual(Object.keys(reference).sort());
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(value.trim().length, `${locale}.${key}`).toBeGreaterThan(0);
        expect(placeholders(value), `${locale}.${key}`).toEqual(placeholders(reference[key]!));
      }
    }
  });

  it.each(catalogs)('%s has sr-Cyrl copy in Cyrillic apart from NestSelf and placeholders', (_name, messages) => {
    for (const [key, value] of Object.entries(messages['sr-Cyrl'])) {
      const stripped = value.replaceAll('NestSelf', '').replace(/\{\{\w+\}\}/g, '');
      expect(stripped, `sr-Cyrl.${key}`).not.toMatch(/[A-Za-zČčĆćŠšŽžĐđ]/);
    }
  });

  it.each(cases)('%s renders subject, text and HTML in %s', (template, locale) => {
    const mail = renderMail(input(template, locale));
    expect(mail.subject.trim()).not.toBe('');
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.subject).not.toMatch(/\{\{|\}\}/);
    expect(mail.text).not.toMatch(/\{\{|\}\}/);
    expect(mail.html).toMatch(new RegExp(`^<!doctype html>\\s*<html lang="${locale}">`));
    expect(mail.html).toContain(`<title>`);
  });

  it.each(cases)('%s in %s names no service category, specialty or wellbeing topic (D-CW-26)', (template, locale) => {
    const mail = renderMail(input(template, locale));
    const everything = [mail.subject, mail.text, mail.html, ...(mail.attachments ?? []).map((a) => a.content)]
      .join('\n')
      .toLowerCase();
    for (const word of [
      'psycholog', 'psiholog', 'психолог', 'pszich',
      'legal', 'pravn', 'правн', 'jogi',
      'financ', 'finansij', 'финансиј', 'pénzügy',
      'therap', 'terap', 'терап',
      'counsel', 'savetovan', 'саветован', 'tanácsad',
      'mental', 'ментал', 'diagnos', 'dijagnoz', 'дијагноз',
      'anxiety', 'stress', 'stres', 'стрес',
    ]) {
      expect(everything, word).not.toContain(word);
    }
  });
});

describe('subjects', () => {
  it('uses the neutral session and webinar subjects (CW-R-43)', () => {
    expect(renderMail(input('appointment.reminder')).subject).toBe('Your NestSelf session');
    expect(renderMail(input('webinar.reminder')).subject).toBe('Your NestSelf webinar');
    expect(renderMail(input('webinar.registration')).subject).toBe('Your NestSelf webinar');
  });

  it.each([
    ['en', 'A follow-up was proposed'],
    ['sr-Latn', 'Predložena je naredna sesija'],
    ['sr-Cyrl', 'Предложена је наредна сесија'],
    ['hu', 'Következő alkalmat javasoltak'],
  ] as const)('sends the follow-up proposal with the calls.json subject in %s (D-CW-37)', (locale, subject) => {
    expect(renderMail(input('appointment.follow_up.proposed', locale)).subject).toBe(subject);
  });

  it.each([
    ['appointment.follow_up.confirmed', 'Your follow-up session is confirmed'],
    ['appointment.follow_up.declined', 'The follow-up session was declined'],
    ['appointment.approval.requested', 'A session approval is waiting for your decision'],
    ['appointment.approval.reminder', 'A session approval is still waiting'],
    ['appointment.approval.decided', 'Your session approval has a decision'],
    ['webinar.recorded_notice', 'Your webinar recording is ready for review'],
  ] as const)('%s has the section 10.5 subject', (template, subject) => {
    expect(renderMail(input(template)).subject).toBe(subject);
  });
});

describe('dates and times', () => {
  it.each([
    ['en', 'Monday, 2 November 2026', '10:00'],
    ['sr-Latn', 'ponedeljak, 2. novembar 2026.', '10:00'],
    ['sr-Cyrl', 'понедељак, 2. новембар 2026.', '10:00'],
    ['hu', '2026. november 2., hétfő', '10:00'],
  ] as const)('formats the date and time in %s with Intl in the appointment time zone', (locale, date, time) => {
    const mail = renderMail(input('appointment.reminder', locale));
    expect(mail.text).toContain(date);
    expect(mail.text).toContain(time);
    expect(mail.html).toContain(date);
  });

  it('follows the appointment time zone, not the server zone', () => {
    const mail = renderMail({
      to: 'a@example.test',
      locale: 'en',
      template: 'appointment.reminder',
      data: { appointment: { ...APPOINTMENT, timeZone: 'America/New_York' }, joinUrl: JOIN_URL },
    });
    expect(mail.text).toContain('Monday, 2 November 2026');
    expect(mail.text).toContain('04:00');
    expect(mail.text).not.toContain('10:00');
  });

  it('shows the zone abbreviation next to the time', () => {
    expect(renderMail(input('appointment.reminder')).text).toContain('10:00 CET');
  });

  it('refuses an invalid instant instead of sending "Invalid Date"', () => {
    expect(() =>
      renderMail({
        to: 'a@example.test',
        locale: 'en',
        template: 'appointment.reminder',
        data: { appointment: { ...APPOINTMENT, startsAt: 'not a date' }, joinUrl: JOIN_URL },
      }),
    ).toThrow(RangeError);
  });
});

describe('bodies', () => {
  it('reminds of the session with the join link in text and HTML', () => {
    const mail = renderMail(input('appointment.reminder'));
    expect(mail.text).toContain('Reminder: session on Monday, 2 November 2026 at 10:00 CET.');
    expect(mail.text).toContain(`Open NestSelf to join: ${JOIN_URL}`);
    expect(mail.html).toContain(`<a href="${JOIN_URL}">Open NestSelf to join</a>`);
  });

  it('sends the follow-up proposal body from calls.json without an ICS', () => {
    const mail = renderMail(input('appointment.follow_up.proposed'));
    expect(mail.text).toContain(
      'A follow-up session was proposed for Monday, 2 November 2026 at 10:00 CET. Open NestSelf to confirm it, suggest other times or decline.',
    );
    expect(mail.text).toContain(APPOINTMENT_URL);
    expect(mail.attachments ?? []).toEqual([]);
  });

  it.each([
    ['en', 'This webinar is recorded. Only the presenters are on the recording.'],
    ['sr-Latn', 'Ovaj vebinar se snima. Na snimku su samo predavači.'],
    ['sr-Cyrl', 'Овај вебинар се снима. На снимку су само предавачи.'],
    ['hu', 'Ez a webinár felvételre kerül. A felvételen csak az előadók szerepelnek.'],
  ] as const)('states the recording notice in the webinar confirmation and reminder in %s (WBN-04)', (locale, notice) => {
    expect(renderMail(input('webinar.registration', locale)).text).toContain(notice);
    expect(renderMail(input('webinar.reminder', locale)).text).toContain(notice);
  });

  it('shows the approver only the name, the neutral label, the date and the duration (CW-R-123)', () => {
    const mail = renderMail(input('appointment.approval.requested'));
    expect(mail.text).toContain(
      'Mila Sample has a follow-up session with a NestSelf expert on Monday, 2 November 2026 at 10:00 CET (50 minutes).',
    );
    expect(mail.text).toContain('https://admin.nestself.rs/approvals');
    expect(mail.text).not.toContain('appt-1');
    expect(mail.attachments ?? []).toEqual([]);
  });

  it('escapes interpolated values in HTML but keeps them raw in text and subject', () => {
    const mail = renderMail({
      to: 'a@example.test',
      locale: 'en',
      template: 'invitation',
      data: { ...samples.invitation, organizationName: 'Example <d.o.o.> & "Partners"' },
    });
    expect(mail.subject).toBe('You are invited to Example <d.o.o.> & "Partners" on NestSelf');
    expect(mail.text).toContain('Example <d.o.o.> & "Partners"');
    expect(mail.html).toContain('Example &lt;d.o.o.&gt; &amp; &quot;Partners&quot;');
    expect(mail.html).not.toContain('<d.o.o.>');
  });

  it('strips line breaks from interpolated values in the subject', () => {
    const mail = renderMail({
      to: 'a@example.test',
      locale: 'en',
      template: 'invitation',
      data: { ...samples.invitation, organizationName: 'Acme\r\nBcc: someone@example.test' },
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it('refuses a link that is not http or https', () => {
    expect(() =>
      renderMail({
        to: 'a@example.test',
        locale: 'en',
        template: 'appointment.reminder',
        data: { appointment: APPOINTMENT, joinUrl: 'javascript:alert(1)' },
      }),
    ).toThrow(/http/);
  });

  it('renders the rejected approval with the safe reason and no calendar file', () => {
    const mail = renderMail({
      to: 'a@example.test',
      locale: 'sr-Latn',
      template: 'appointment.approval.decided',
      data: { appointment: APPOINTMENT, decision: 'rejected', reason: 'Termin <nije> moguć', appointmentUrl: APPOINTMENT_URL },
    });
    expect(mail.text).toContain('nije odobrena');
    expect(mail.text).toContain('Razlog: Termin <nije> moguć');
    expect(mail.html).toContain('Razlog: Termin &lt;nije&gt; moguć');
    expect(mail.attachments ?? []).toEqual([]);
  });

  it('omits the reason line when the approver gave none', () => {
    const mail = renderMail({
      to: 'a@example.test',
      locale: 'en',
      template: 'appointment.approval.decided',
      data: { appointment: APPOINTMENT, decision: 'rejected', reason: null, appointmentUrl: APPOINTMENT_URL },
    });
    expect(mail.text).not.toContain('Reason');
  });

  it('omits the booking link of the no-show follow-up until a booking URL exists', () => {
    const mail = renderMail({
      to: 'a@example.test',
      locale: 'en',
      template: 'appointment.no_show_followup',
      data: { appointment: APPOINTMENT, reportProblemUrl: 'https://app.nestself.rs/support/new' },
    });
    expect(mail.text).toContain('Report a technical problem: https://app.nestself.rs/support/new');
    expect(mail.text).not.toContain('Book another session');
  });
});

// ---------------------------------------------------------------------------
// Calendar attachments
// ---------------------------------------------------------------------------

function unfoldIcs(ics: string): string[] {
  return ics.replaceAll('\r\n ', '').split('\r\n');
}

describe('calendar attachments', () => {
  it.each([
    ['appointment.reminder', 'REQUEST', `appointment-appt-1@${ICS_UID_DOMAIN}`, 'NestSelf session'],
    ['appointment.follow_up.confirmed', 'REQUEST', `appointment-appt-1@${ICS_UID_DOMAIN}`, 'NestSelf session'],
    ['appointment.approval.decided', 'REQUEST', `appointment-appt-1@${ICS_UID_DOMAIN}`, 'NestSelf session'],
    ['appointment.canceled', 'CANCEL', `appointment-appt-1@${ICS_UID_DOMAIN}`, 'NestSelf session'],
    ['webinar.registration', 'REQUEST', `webinar-registration-reg-1@${ICS_UID_DOMAIN}`, 'NestSelf webinar'],
    ['webinar.reminder', 'REQUEST', `webinar-registration-reg-1@${ICS_UID_DOMAIN}`, 'NestSelf webinar'],
    ['webinar.canceled', 'CANCEL', `webinar-registration-reg-1@${ICS_UID_DOMAIN}`, 'NestSelf webinar'],
  ] as const)('%s attaches a %s text/calendar part', (template, method, uid, summary) => {
    const attachments = renderMail(input(template)).attachments ?? [];
    expect(attachments).toHaveLength(1);
    const [ics] = attachments;
    expect(ics!.contentType).toBe(`text/calendar; charset=UTF-8; method=${method}`);
    expect(ics!.filename).toMatch(/\.ics$/);
    const lines = unfoldIcs(ics!.content);
    expect(lines).toContain(`METHOD:${method}`);
    expect(lines).toContain(`UID:${uid}`);
    expect(lines).toContain(`SUMMARY:${summary}`);
    expect(lines).toContain('CLASS:PRIVATE');
    expect(lines).toContain('X-MICROSOFT-CDO-BUSYSTATUS:BUSY');
    expect(lines.some((l) => l.startsWith('DTSTART;TZID=Europe/Belgrade:'))).toBe(true);
    expect(lines).toContain(method === 'CANCEL' ? 'SEQUENCE:1' : 'SEQUENCE:0');
  });

  it.each([
    'appointment.no_show_followup',
    'appointment.follow_up.proposed',
    'appointment.follow_up.declined',
    'appointment.approval.requested',
    'appointment.approval.reminder',
    'webinar.recorded_notice',
    'invitation',
  ] as const)('%s has no calendar file', (template) => {
    expect(renderMail(input(template)).attachments ?? []).toEqual([]);
  });

  it('puts the authenticated join link in DESCRIPTION', () => {
    const [ics] = renderMail(input('appointment.reminder')).attachments!;
    expect(unfoldIcs(ics!.content)).toContain(`DESCRIPTION:Sign in to NestSelf to join: ${JOIN_URL}`);
  });

  it('localises the neutral SUMMARY', () => {
    const [ics] = renderMail(input('appointment.reminder', 'sr-Cyrl')).attachments!;
    expect(unfoldIcs(ics!.content)).toContain('SUMMARY:NestSelf сесија');
    const [webinarIcs] = renderMail(input('webinar.registration', 'hu')).attachments!;
    expect(unfoldIcs(webinarIcs!.content)).toContain('SUMMARY:NestSelf webinár');
  });

  it('carries a caller-provided SEQUENCE for updates', () => {
    const [ics] = renderMail({
      to: 'a@example.test',
      locale: 'en',
      template: 'appointment.reminder',
      data: { appointment: APPOINTMENT, joinUrl: JOIN_URL, sequence: 2 },
    }).attachments!;
    expect(unfoldIcs(ics!.content)).toContain('SEQUENCE:2');
  });
});

// ---------------------------------------------------------------------------
// SES raw MIME
// ---------------------------------------------------------------------------

interface MimePart {
  headers: Map<string, string>;
  body: string;
  parts: MimePart[];
}

function parseMime(raw: string): MimePart {
  const split = raw.indexOf('\r\n\r\n');
  const headerBlock = raw.slice(0, split).replace(/\r\n[ \t]/g, ' ');
  const body = raw.slice(split + 4);
  const headers = new Map<string, string>();
  for (const line of headerBlock.split('\r\n')) {
    const colon = line.indexOf(':');
    headers.set(line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim());
  }
  const contentType = headers.get('content-type') ?? '';
  const boundary = /boundary="([^"]+)"/.exec(contentType)?.[1];
  const parts: MimePart[] = [];
  if (contentType.startsWith('multipart/') && boundary) {
    const sections = body.split(`--${boundary}`);
    expect(sections.at(-1)!.startsWith('--')).toBe(true);
    for (const section of sections.slice(1, -1)) {
      expect(section.startsWith('\r\n')).toBe(true);
      expect(section.endsWith('\r\n')).toBe(true);
      parts.push(parseMime(section.slice(2, -2)));
    }
  }
  return { headers, body, parts };
}

function decodeBase64Body(part: MimePart): string {
  expect(part.headers.get('content-transfer-encoding')).toBe('base64');
  for (const line of part.body.split('\r\n')) expect(line.length).toBeLessThanOrEqual(76);
  return Buffer.from(part.body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

function decodeEncodedWords(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => {
      const match = /^=\?UTF-8\?B\?([A-Za-z0-9+/=]*)\?=$/.exec(word);
      expect(match, word).not.toBeNull();
      return Buffer.from(match![1]!, 'base64');
    })
    .reduce((all, bytes) => Buffer.concat([all, bytes]), Buffer.alloc(0))
    .toString('utf8');
}

function toCrlf(value: string): string {
  return value.replace(/\r?\n/g, '\r\n');
}

describe('SesMailer', () => {
  const ses = mockClient(SESClient);

  beforeEach(() => {
    ses.reset();
    ses.on(SendRawEmailCommand).resolves({ MessageId: 'msg-1' });
  });

  afterEach(() => vi.restoreAllMocks());

  function mailer(): SesMailer {
    return new SesMailer({ fromEmail: 'no-reply@nestself.example', region: 'eu-central-1' });
  }

  async function sendAndCapture(mail: MailInput): Promise<{ raw: string; command: SendRawEmailCommandInput }> {
    await mailer().send(mail);
    const calls = ses.commandCalls(SendRawEmailCommand);
    expect(calls).toHaveLength(1);
    const command = calls[0]!.args[0].input;
    const raw = Buffer.from(command.RawMessage!.Data!).toString('utf8');
    return { raw, command };
  }

  it('sends one raw message from the configured sender to the recipient', async () => {
    const { command } = await sendAndCapture(input('appointment.reminder'));
    expect(command.Source).toBe('no-reply@nestself.example');
    expect(command.Destinations).toEqual(['mila@example.test']);
  });

  it('uses CRLF line endings and keeps every line within 78 characters', async () => {
    const { raw } = await sendAndCapture(input('appointment.reminder', 'sr-Cyrl'));
    expect(raw.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    for (const line of raw.split('\r\n')) expect(line.length).toBeLessThanOrEqual(78);
    // 7-bit clean: the subject is RFC 2047 encoded and every body is base64.
    expect(raw).toMatch(/^[\x20-\x7e\r\n]*$/);
  });

  it('builds multipart/mixed with text and HTML alternatives and the text/calendar part', async () => {
    const mail = input('appointment.reminder', 'hu');
    const rendered = renderMail(mail);
    const { raw } = await sendAndCapture(mail);
    const root = parseMime(raw);

    expect(root.headers.get('mime-version')).toBe('1.0');
    expect(root.headers.get('from')).toBe('no-reply@nestself.example');
    expect(root.headers.get('to')).toBe('mila@example.test');
    expect(root.headers.get('date')).toMatch(/^[A-Z][a-z]{2}, \d{2} [A-Z][a-z]{2} \d{4} \d{2}:\d{2}:\d{2} \+0000$/);
    expect(decodeEncodedWords(root.headers.get('subject')!)).toBe(rendered.subject);
    expect(root.headers.get('content-type')).toMatch(/^multipart\/mixed; boundary="/);
    expect(root.parts).toHaveLength(2);

    const [alternative, calendar] = root.parts;
    expect(alternative!.headers.get('content-type')).toMatch(/^multipart\/alternative; boundary="/);
    expect(alternative!.parts).toHaveLength(2);
    const [text, html] = alternative!.parts;
    expect(text!.headers.get('content-type')).toBe('text/plain; charset=UTF-8');
    expect(decodeBase64Body(text!)).toBe(toCrlf(rendered.text));
    expect(html!.headers.get('content-type')).toBe('text/html; charset=UTF-8');
    expect(decodeBase64Body(html!)).toBe(toCrlf(rendered.html));

    expect(calendar!.headers.get('content-type')).toBe(
      'text/calendar; charset=UTF-8; method=REQUEST; name="nestself-session.ics"',
    );
    expect(calendar!.headers.get('content-disposition')).toBe('attachment; filename="nestself-session.ics"');
    const ics = decodeBase64Body(calendar!);
    const withoutStamp = (value: string): string => value.replace(/DTSTAMP:\d{8}T\d{6}Z/, 'DTSTAMP');
    expect(withoutStamp(ics)).toBe(withoutStamp(rendered.attachments![0]!.content));
    expect(ics).toContain('METHOD:REQUEST');
  });

  it('sends multipart/alternative alone when there is no attachment', async () => {
    const { raw } = await sendAndCapture(input('appointment.follow_up.proposed', 'sr-Latn'));
    const root = parseMime(raw);
    expect(root.headers.get('content-type')).toMatch(/^multipart\/alternative; boundary="/);
    expect(root.parts.map((p) => p.headers.get('content-type'))).toEqual([
      'text/plain; charset=UTF-8',
      'text/html; charset=UTF-8',
    ]);
    expect(decodeEncodedWords(root.headers.get('subject')!)).toBe('Predložena je naredna sesija');
  });

  it('cannot be made to inject a header through an interpolated value', async () => {
    const { raw } = await sendAndCapture({
      to: 'mila@example.test',
      locale: 'en',
      template: 'invitation',
      data: { ...samples.invitation, organizationName: 'Acme\r\nBcc: someone@example.test' },
    });
    const headerBlock = raw.slice(0, raw.indexOf('\r\n\r\n'));
    expect(headerBlock).not.toMatch(/^bcc:/im);
  });

  it('refuses a recipient with line breaks or several addresses and sends nothing', async () => {
    for (const to of ['mila@example.test\r\nBcc: x@example.test', 'a@example.test, b@example.test', 'not-an-address']) {
      await expect(mailer().send({ ...input('appointment.reminder'), to })).rejects.toThrow(/recipient/i);
    }
    expect(ses.commandCalls(SendRawEmailCommand)).toHaveLength(0);
  });

  it('propagates SES failures so the caller can handle them', async () => {
    ses.on(SendRawEmailCommand).rejects(new Error('MessageRejected'));
    await expect(mailer().send(input('appointment.reminder'))).rejects.toThrow('MessageRejected');
  });

  it('logs the template and the recipient domain only', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await mailer().send(input('appointment.reminder'));
    const messages = log.mock.calls.map((call) => String(call[0])).join('\n');
    expect(messages).toContain('appointment.reminder');
    expect(messages).toContain('example.test');
    expect(messages).not.toContain('mila@');
    expect(messages).not.toContain(JOIN_URL);
  });
});

// ---------------------------------------------------------------------------
// Logging mailer and module factory
// ---------------------------------------------------------------------------

describe('LoggingMailer', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs subject, template, locale and recipient domain at info level', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await new LoggingMailer().send(input('appointment.reminder', 'en', 'mila.sample@client.example'));
    expect(log).toHaveBeenCalledOnce();
    const message = String(log.mock.calls[0]![0]);
    expect(message).toContain('appointment.reminder');
    expect(message).toContain('en');
    expect(message).toContain('client.example');
    expect(message).toContain('Your NestSelf session');
  });

  it('never logs the full address, the body or the join link', async () => {
    const spies = (['log', 'debug', 'verbose', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(Logger.prototype, level).mockImplementation(() => undefined),
    );
    await new LoggingMailer().send(input('appointment.reminder', 'en', 'mila.sample@client.example'));
    const logged = spies.flatMap((spy) => spy.mock.calls.map((call) => call.map(String).join(' '))).join('\n');
    expect(logged).not.toContain('mila.sample');
    expect(logged).not.toContain(JOIN_URL);
    expect(logged).not.toContain('Reminder: session');
  });

  it('still renders, so a broken template fails in development too', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await expect(
      new LoggingMailer().send({
        to: 'a@example.test',
        locale: 'en',
        template: 'appointment.reminder',
        data: { appointment: { ...APPOINTMENT, timeZone: 'Mars/Olympus_Mons' }, joinUrl: JOIN_URL },
      }),
    ).rejects.toThrow(RangeError);
  });
});

describe('createMailer', () => {
  function config(values: Record<string, string | undefined>): { get: <T>(key: string) => T | undefined } {
    return { get: <T,>(key: string) => values[key] as T | undefined };
  }

  it('uses SES when a sender is configured outside tests (D-29)', () => {
    const settings = config({ SES_FROM_EMAIL: 'no-reply@nestself.example', NODE_ENV: 'production' });
    expect(createMailer(settings)).toBeInstanceOf(SesMailer);
    expect(sesMailerOptions(settings)).toEqual({ fromEmail: 'no-reply@nestself.example', region: 'eu-central-1' });
  });

  it('uses the configured region when set', () => {
    const settings = config({ SES_FROM_EMAIL: 'a@nestself.example', NODE_ENV: 'development', COGNITO_REGION: 'eu-central-1' });
    expect(sesMailerOptions(settings)?.region).toBe('eu-central-1');
  });

  it('logs instead when no sender is configured', () => {
    expect(createMailer(config({ NODE_ENV: 'production' }))).toBeInstanceOf(LoggingMailer);
  });

  it('never uses SES under test', () => {
    expect(createMailer(config({ SES_FROM_EMAIL: 'a@nestself.example', NODE_ENV: 'test' }))).toBeInstanceOf(LoggingMailer);
  });
});
