import { describe, expect, it } from 'vitest';
import { locales, type Locale } from '@nestself/contracts';
import { EMAIL_TEMPLATES } from './email-templates.js';
import type { MailTemplate } from './mailer.js';
import { renderMail } from './render-mail.js';

const CODE_PARAMS = { code: '12345678', minutes: '5' };

/** Every param a template takes: what its callers pass. */
const FULL_PARAMS: Record<MailTemplate, Record<string, string>> = {
  invitation: {
    link: 'https://app.example.test/invitations/tok_123',
    organizationName: 'Intesa d.o.o.',
    inviterDisplayName: 'Ivana',
  },
  step_up_code: CODE_PARAMS,
  sso_bind_code: CODE_PARAMS,
  ops_certificate_alert: {
    organizationName: 'Intesa d.o.o.',
    providerName: 'org-intesa-saml',
    expiresAt: '2026-12-01',
    daysLeft: '12',
    adminUrl: 'https://admin.example.test/sso',
  },
};

const TEMPLATES = Object.keys(EMAIL_TEMPLATES) as MailTemplate[];

describe('renderMail', () => {
  it('substitutes params and escapes html', () => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'step_up_code',
      params: CODE_PARAMS,
    });

    expect(out.subject).toBe('Your NestSelf verification code');
    expect(out.text).toContain('Your verification code is 12345678. It expires in 5 minutes.');
    expect(out.text).toContain('If you did not request this, ignore this email.');
    expect(out.html).not.toContain('<script');
  });

  it('renders one paragraph per non-empty line of the text', () => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'step_up_code',
      params: CODE_PARAMS,
    });

    expect(out.text).toBe(
      'Your verification code is 12345678. It expires in 5 minutes.\n\nIf you did not request this, ignore this email.',
    );
    expect(out.html).toBe(
      '<p>Your verification code is 12345678. It expires in 5 minutes.</p>\n<p>If you did not request this, ignore this email.</p>',
    );
  });

  it('escapes every value in the html and leaves the subject and text as written', () => {
    const organizationName = 'Example <script>alert("x")</script> & Co';
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'invitation',
      params: { ...FULL_PARAMS.invitation, organizationName, inviterDisplayName: "Conan O'Brien" },
    });

    expect(out.html).not.toContain('<script');
    expect(out.html).toContain(
      'Example &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; Co',
    );
    expect(out.html).toContain('Conan O&#39;Brien');
    expect(out.text).toContain(organizationName);
    expect(out.subject).toBe(`You are invited to ${organizationName} on NestSelf`);
  });

  it('puts the invitation link in the text and in the html', () => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'invitation',
      params: FULL_PARAMS.invitation,
    });

    expect(out.text).toContain(
      'Open this link to activate your access: https://app.example.test/invitations/tok_123',
    );
    expect(out.html).toContain('https://app.example.test/invitations/tok_123');
  });

  it('replaces a missing param with an empty string', () => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'step_up_code',
      params: { code: '12345678' },
    });

    expect(out.text).toContain('12345678');
    expect(out.text).not.toContain('{{');
    expect(out.text).not.toContain('undefined');
  });

  it('keeps the subject on a single line', () => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'invitation',
      params: {
        ...FULL_PARAMS.invitation,
        organizationName: 'Example\r\nBcc: victim@example.test',
      },
    });

    expect(out.subject).toBe('You are invited to Example Bcc: victim@example.test on NestSelf');
  });

  it('does not let a value add paragraphs to the html', () => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'invitation',
      params: {
        ...FULL_PARAMS.invitation,
        inviterDisplayName: 'Ivana\n\nOpen https://evil.example',
      },
    });

    expect(out.html.match(/<p>/g)).toHaveLength(3);
  });

  it.each(['de', '__proto__', 'constructor'])(
    'falls back to sr-Latn for the unknown locale %s',
    (locale) => {
      const message = { to: 'a@b.c', template: 'step_up_code', params: CODE_PARAMS } as const;

      expect(renderMail({ ...message, locale: locale as Locale })).toEqual(
        renderMail({ ...message, locale: 'sr-Latn' }),
      );
    },
  );

  it('renders the Cyrillic copy for sr-Cyrl', () => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'sr-Cyrl',
      template: 'step_up_code',
      params: CODE_PARAMS,
    });

    expect(out.text).toContain('Ваш верификациони код је 12345678.');
  });

  describe.each(TEMPLATES)('%s', (template) => {
    it.each(locales)(
      'renders in %s with every param in place and no placeholder left',
      (locale) => {
        const params = FULL_PARAMS[template];
        const out = renderMail({ to: 'a@b.c', locale, template, params });

        for (const part of [out.subject, out.text, out.html]) {
          expect(part).not.toMatch(/\{\{|\}\}/);
          expect(part).not.toContain('undefined');
        }
        for (const value of Object.values(params)) {
          expect(out.subject + out.text).toContain(value);
        }
      },
    );
  });
});
