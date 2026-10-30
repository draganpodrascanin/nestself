import { describe, it, expect } from 'vitest';
import {
  CallParticipantRoleSchema,
  TimeZoneSchema,
  WEBINAR_SINGLE_MEETING_CAPACITY,
  WebinarMessageKindSchema,
  WebinarMessageStatusSchema,
} from '@nestself/contracts';
import {
  SAMPLE_CALL_SESSIONS,
  SAMPLE_ORG,
  SAMPLE_PEOPLE,
  SAMPLE_WEBINARS,
  SAMPLE_WEBINAR_MESSAGES,
  SAMPLE_WEBINAR_POLLS,
} from '../index.ts';

const LOCALES = ['en', 'sr-Latn', 'sr-Cyrl', 'hu'] as const;

/** Clinical labels a webinar title or description must not carry (content rule). */
const CLINICAL_TERMS = [
  'burnout',
  'anxiety',
  'depression',
  'disorder',
  'therapy',
  'diagnos',
  'trauma',
  'izgaranje',
  'anksioznost',
  'depresij',
  'poremećaj',
  'terapij',
  'dijagnoz',
  'изгарање',
  'анксиозност',
  'депресиј',
  'поремећај',
  'терапиј',
  'дијагноз',
  'kiégés',
  'szorong',
  'depresszi',
  'terápi',
  'diagnózi',
];

const people = new Map<string, (typeof SAMPLE_PEOPLE)[number]>(SAMPLE_PEOPLE.map((p) => [p.id, p]));
const webinarIds = new Set(SAMPLE_WEBINARS.map((w) => w.id));

function webinarByStatus(status: string) {
  const found = SAMPLE_WEBINARS.filter((w) => w.status === status);
  expect(found).toHaveLength(1);
  return found[0]!;
}

function sessionOf(webinarId: string) {
  const found = SAMPLE_CALL_SESSIONS.filter((s) => s.webinarId === webinarId);
  expect(found).toHaveLength(1);
  return found[0]!;
}

describe('SAMPLE_WEBINARS', () => {
  it('has two webinars with unique ids, one published upcoming and one ended, all marked as sample', () => {
    expect(SAMPLE_WEBINARS).toHaveLength(2);
    expect(webinarIds.size).toBe(2);
    const upcoming = webinarByStatus('published');
    const ended = webinarByStatus('ended');
    expect(Date.parse(upcoming.startsAt)).toBeGreaterThan(Date.parse(ended.endsAt));
    for (const w of SAMPLE_WEBINARS) expect(w.sample).toBe(true);
  });

  it('has a title and a description in all four locales', () => {
    for (const w of SAMPLE_WEBINARS) {
      for (const locale of LOCALES) {
        expect(w.title[locale].trim().length).toBeGreaterThan(0);
        expect(w.description[locale].trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('keeps titles and descriptions neutral, without clinical labels', () => {
    for (const w of SAMPLE_WEBINARS) {
      const text = LOCALES.flatMap((l) => [w.title[l], w.description[l]])
        .join(' ')
        .toLowerCase();
      for (const term of CLINICAL_TERMS) expect(text).not.toContain(term);
    }
  });

  it('schedules in Europe/Belgrade with a positive window and a single-meeting capacity', () => {
    for (const w of SAMPLE_WEBINARS) {
      expect(TimeZoneSchema.safeParse(w.timeZone).success).toBe(true);
      expect(w.timeZone).toBe('Europe/Belgrade');
      expect(Date.parse(w.endsAt)).toBeGreaterThan(Date.parse(w.startsAt));
      expect(Number.isInteger(w.capacity)).toBe(true);
      expect(w.capacity).toBeGreaterThan(0);
      expect(w.capacity).toBeLessThanOrEqual(WEBINAR_SINGLE_MEETING_CAPACITY);
    }
  });

  it('carries org_id null only for the all_eligible audience, otherwise the sample organisation', () => {
    const policies = SAMPLE_WEBINARS.map((w) => w.audiencePolicy);
    expect(policies).toContain('all_eligible');
    for (const w of SAMPLE_WEBINARS) {
      if (w.audiencePolicy === 'all_eligible') expect(w.orgId).toBeNull();
      else {
        expect(w.orgId).toBe(SAMPLE_ORG.id);
        expect(w.audiencePolicy).toBe(SAMPLE_ORG.id);
      }
    }
  });

  it('has a moderated chat and no recording switch (every webinar is recorded)', () => {
    for (const w of SAMPLE_WEBINARS) {
      expect(w.chatPolicy).toBe('moderated');
      expect(Object.keys(w).some((key) => /record/i.test(key))).toBe(false);
    }
  });

  it('names one moderator and at least one presenter, sample people shown by first name only', () => {
    for (const w of SAMPLE_WEBINARS) {
      expect(people.has(w.createdByUserId)).toBe(true);
      expect(w.hosts.filter((h) => h.role === 'moderator')).toHaveLength(1);
      expect(w.hosts.filter((h) => h.role === 'presenter').length).toBeGreaterThanOrEqual(1);
      for (const host of w.hosts) {
        expect(CallParticipantRoleSchema.safeParse(host.role).success).toBe(true);
        const person = people.get(host.userId);
        expect(person).toBeDefined();
        expect(host.displayName).not.toContain(' ');
        expect(person!.displayName.split(' ')[0]).toBe(host.displayName);
      }
    }
  });

  it('gives the ended webinar an ended session in SAMPLE_CALL_SESSIONS and the upcoming one none', () => {
    const ended = webinarByStatus('ended');
    const session = sessionOf(ended.id);
    expect(session.format).toBe('webinar');
    expect(session.status).toBe('ended');
    expect(session.appointmentId).toBeNull();
    expect(session.orgId).toBe(ended.orgId);
    expect(session.startsAt).toBe(ended.startsAt);
    expect(session.endsAt).toBe(ended.endsAt);
    expect(session.outcome).toBeNull();
    expect(session.feedback).toHaveLength(0);
    const upcoming = webinarByStatus('published');
    expect(SAMPLE_CALL_SESSIONS.some((s) => s.webinarId === upcoming.id)).toBe(false);
  });

  it('lists the hosts in the webinar session with their roles, and attendees from the sample organisation', () => {
    const ended = webinarByStatus('ended');
    const session = sessionOf(ended.id);
    for (const host of ended.hosts) {
      expect(session.participants.some((p) => p.userId === host.userId && p.role === host.role)).toBe(true);
    }
    const attendees = session.participants.filter((p) => p.role === 'attendee');
    expect(attendees.length).toBeGreaterThanOrEqual(2);
    for (const a of attendees) expect(people.get(a.userId)?.orgId).toBe(SAMPLE_ORG.id);
  });
});

describe('SAMPLE_WEBINAR_MESSAGES', () => {
  it('has five messages with unique ids, all marked as sample and using the contract enums', () => {
    expect(SAMPLE_WEBINAR_MESSAGES).toHaveLength(5);
    expect(new Set(SAMPLE_WEBINAR_MESSAGES.map((m) => m.id)).size).toBe(5);
    for (const m of SAMPLE_WEBINAR_MESSAGES) {
      expect(m.sample).toBe(true);
      expect(WebinarMessageKindSchema.safeParse(m.kind).success).toBe(true);
      expect(WebinarMessageStatusSchema.safeParse(m.status).success).toBe(true);
      expect(m.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('has two host messages, two attendee messages and one question', () => {
    const count = (kind: string) => SAMPLE_WEBINAR_MESSAGES.filter((m) => m.kind === kind).length;
    expect(count('host')).toBe(2);
    expect(count('attendee')).toBe(2);
    expect(count('question')).toBe(1);
  });

  it('publishes host messages immediately (CW-R-103)', () => {
    for (const m of SAMPLE_WEBINAR_MESSAGES.filter((x) => x.kind === 'host')) {
      expect(m.status).toBe('published');
      expect(m.publishedAt).not.toBeNull();
    }
  });

  it('gives the attendee messages mixed statuses, one of them published', () => {
    const statuses = SAMPLE_WEBINAR_MESSAGES.filter((m) => m.kind === 'attendee').map((m) => m.status);
    expect(statuses).toContain('published');
    expect(new Set(statuses).size).toBe(2);
  });

  it('sets publishedAt exactly for published and answered messages, and an answer only on an answered one', () => {
    for (const m of SAMPLE_WEBINAR_MESSAGES) {
      const visible = m.status === 'published' || m.status === 'answered';
      expect(m.publishedAt !== null).toBe(visible);
      expect(m.answerText !== null).toBe(m.status === 'answered');
    }
  });

  it('belongs to the ended webinar and its session, written by participants of that session in a matching role', () => {
    const ended = webinarByStatus('ended');
    const session = sessionOf(ended.id);
    const participants = new Map(session.participants.map((p) => [p.id, p]));
    for (const m of SAMPLE_WEBINAR_MESSAGES) {
      expect(m.webinarId).toBe(ended.id);
      expect(m.sessionId).toBe(session.id);
      expect(m.authorParticipantId).not.toBeNull();
      const author = participants.get(m.authorParticipantId!);
      expect(author).toBeDefined();
      if (m.kind === 'host') expect(['presenter', 'moderator']).toContain(author!.role);
      else expect(author!.role).toBe('attendee');
      expect(Date.parse(m.createdAt)).toBeGreaterThanOrEqual(Date.parse(session.startedAt!));
      expect(Date.parse(m.createdAt)).toBeLessThanOrEqual(Date.parse(session.endedAt!));
    }
  });

  it('keeps attendee messages anonymous by default, with at most one opting in to the first name', () => {
    const fromAttendees = SAMPLE_WEBINAR_MESSAGES.filter((m) => m.kind !== 'host');
    expect(fromAttendees.some((m) => !m.showFirstName)).toBe(true);
    expect(fromAttendees.filter((m) => m.showFirstName).length).toBeLessThanOrEqual(1);
  });
});

describe('SAMPLE_WEBINAR_POLLS', () => {
  it('has one poll with three options on the ended webinar, marked as sample', () => {
    expect(SAMPLE_WEBINAR_POLLS).toHaveLength(1);
    const poll = SAMPLE_WEBINAR_POLLS[0]!;
    const ended = webinarByStatus('ended');
    expect(poll.sample).toBe(true);
    expect(poll.webinarId).toBe(ended.id);
    expect(poll.sessionId).toBe(sessionOf(ended.id).id);
    expect(poll.question.trim().length).toBeGreaterThan(0);
    expect(poll.options).toHaveLength(3);
    expect(new Set(poll.options.map((o) => o.id)).size).toBe(3);
    expect(poll.options.map((o) => o.position)).toEqual([0, 1, 2]);
  });

  it('was opened and closed during the session', () => {
    const poll = SAMPLE_WEBINAR_POLLS[0]!;
    const session = sessionOf(poll.webinarId);
    expect(Date.parse(poll.openedAt)).toBeGreaterThanOrEqual(Date.parse(session.startedAt!));
    expect(Date.parse(poll.closedAt)).toBeGreaterThan(Date.parse(poll.openedAt));
    expect(Date.parse(poll.closedAt)).toBeLessThanOrEqual(Date.parse(session.endedAt!));
  });

  it('stores results as aggregate counts per option, never a voter (CW-R-24)', () => {
    const poll = SAMPLE_WEBINAR_POLLS[0]!;
    const optionIds = new Set(poll.options.map((o) => o.id));
    expect(poll.results).toHaveLength(3);
    for (const result of poll.results) {
      expect(Object.keys(result).sort()).toEqual(['count', 'optionId']);
      expect(optionIds.has(result.optionId)).toBe(true);
      expect(Number.isInteger(result.count)).toBe(true);
      expect(result.count).toBeGreaterThanOrEqual(0);
    }
    const attendees = sessionOf(poll.webinarId).participants.filter((p) => p.role === 'attendee');
    expect(poll.results.reduce((sum, r) => sum + r.count, 0)).toBeLessThanOrEqual(attendees.length);
  });
});
