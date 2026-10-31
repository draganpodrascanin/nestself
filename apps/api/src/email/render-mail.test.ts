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

  it('links a value that starts with https:// in the html and leaves the text as written', () => {
    const link = 'https://app.example.test/invitations/tok_123';
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'invitation',
      params: FULL_PARAMS.invitation,
    });

    expect(out.html).toContain(
      `<p>Open this link to activate your access: <a href="${link}">${link}</a></p>`,
    );
    expect(out.text).toContain(`Open this link to activate your access: ${link}`);
    expect(out.text).not.toContain('<a');
    expect(out.subject).not.toContain('<a');
  });

  it('escapes both the href and the text of a linked value', () => {
    const link = 'https://app.example.test/x?a=1&b="2"<i>\'';
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'invitation',
      params: { ...FULL_PARAMS.invitation, link },
    });

    const escaped = 'https://app.example.test/x?a=1&amp;b=&quot;2&quot;&lt;i&gt;&#39;';
    expect(out.html).toContain(`<a href="${escaped}">${escaped}</a>`);
    expect(out.html).not.toContain('<i>');
  });

  it.each([
    ['a scheme other than https', 'http://app.example.test/invitations/tok_123'],
    ['a javascript: url', 'javascript:alert(1)'],
    ['a value that only contains https://', 'see https://evil.example/login'],
    ['an upper-case scheme', 'HTTPS://app.example.test/invitations/tok_123'],
    ['plain words', 'Ivana'],
  ])('does not link %s', (_label, value) => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'invitation',
      params: { ...FULL_PARAMS.invitation, inviterDisplayName: value },
    });

    // The activation link is the only anchor: the value under test is not a link.
    expect(out.html.match(/<a[ >]/g)).toHaveLength(1);
  });

  it('throws when a placeholder has no param, naming the template and the placeholder', () => {
    expect(() =>
      renderMail({
        to: 'a@b.c',
        locale: 'en',
        template: 'step_up_code',
        params: { code: '12345678' },
      }),
    ).toThrow(/step_up_code.*minutes/);
  });

  it('throws for a misnamed param, because the param the template wants is then missing', () => {
    expect(() =>
      renderMail({
        to: 'a@b.c',
        locale: 'sr-Latn',
        template: 'invitation',
        params: {
          link: 'https://app.example.test/invitations/tok_123',
          inviterDisplayName: 'Ivana',
          organisationName: 'Intesa d.o.o.', // sic: the template wants `organizationName`
        },
      }),
    ).toThrow(/invitation.*organizationName/);
  });

  it('never puts a param value into the error', () => {
    let message = '';
    try {
      renderMail({
        to: 'dragan@intesa.example',
        locale: 'en',
        template: 'step_up_code',
        params: { code: '87654321' },
      });
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).not.toBe('');
    expect(message).not.toContain('87654321');
    expect(message).not.toContain('dragan');
  });

  it('accepts an empty string as a value: only an absent param is an error', () => {
    const out = renderMail({
      to: 'a@b.c',
      locale: 'en',
      template: 'step_up_code',
      params: { code: '', minutes: '5' },
    });

    expect(out.text).toContain('Your verification code is . It expires in 5 minutes.');
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
