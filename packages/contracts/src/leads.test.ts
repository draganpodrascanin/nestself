import { describe, expect, it } from 'vitest';
import {
  DemoRequestSchema,
  ContactMessageSchema,
  WebinarRegistrationSchema,
  LeadSchema,
  LeadAcceptedSchema,
  CompanySizeSchema,
  CountrySchema,
} from './leads.ts';

describe('leads', () => {
  const validDemo = {
    kind: 'demo_request' as const,
    name: 'Test Person',
    email: '  Test@Example.Com  ',
    company: 'Example d.o.o.',
    companySize: '50-199' as const,
    country: 'RS' as const,
    locale: 'en' as const,
    consent: true as const,
  };

  it('parses a valid demo request and lower-cases the email', () => {
    const result = DemoRequestSchema.parse(validDemo);
    expect(result.email).toBe('test@example.com');
    expect(result.name).toBe('Test Person');
    expect(result.kind).toBe('demo_request');
  });

  it('rejects consent: false', () => {
    expect(() =>
      DemoRequestSchema.parse({ ...validDemo, consent: false }),
    ).toThrow();
  });

  it('accepts a filled honeypot so the service can silently discard', () => {
    const result = DemoRequestSchema.parse({ ...validDemo, website: 'http://spam.com' });
    expect(result.website).toBe('http://spam.com');
  });

  it('rejects unknown kind via discriminated union', () => {
    expect(() =>
      LeadSchema.parse({ ...validDemo, kind: 'unknown_kind' }),
    ).toThrow();
  });

  it('rejects webinarSlug with spaces', () => {
    expect(() =>
      WebinarRegistrationSchema.parse({
        kind: 'webinar_registration',
        webinarSlug: 'has spaces',
        name: 'Test',
        email: 'test@test.com',
        locale: 'en',
        consent: true,
      }),
    ).toThrow();
  });

  it('parses a valid contact message', () => {
    const result = ContactMessageSchema.parse({
      kind: 'contact',
      name: 'Test',
      email: 'test@test.com',
      subject: 'Hello',
      message: 'World',
      locale: 'en',
      consent: true,
    });
    expect(result.kind).toBe('contact');
  });

  it('parses a valid webinar registration', () => {
    const result = WebinarRegistrationSchema.parse({
      kind: 'webinar_registration',
      webinarSlug: 'stress-management-101',
      name: 'Test',
      email: 'test@test.com',
      locale: 'hu',
      consent: true,
    });
    expect(result.kind).toBe('webinar_registration');
    expect(result.locale).toBe('hu');
  });

  it('parses LeadAccepted shape', () => {
    const result = LeadAcceptedSchema.parse({
      id: 'lead_1',
      kind: 'demo_request',
      receivedAt: '2026-10-21T10:00:00Z',
    });
    expect(result.id).toBe('lead_1');
  });

  it('CompanySizeSchema accepts valid sizes', () => {
    expect(CompanySizeSchema.parse('1-49')).toBe('1-49');
    expect(CompanySizeSchema.parse('1000+')).toBe('1000+');
  });

  it('CountrySchema accepts valid countries', () => {
    expect(CountrySchema.parse('RS')).toBe('RS');
    expect(CountrySchema.parse('HU')).toBe('HU');
    expect(CountrySchema.parse('OTHER')).toBe('OTHER');
  });
});
