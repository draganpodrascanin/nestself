/**
 * Turns a `MailMessage` into the subject, plain text and HTML that an adapter
 * delivers.
 *
 * - `{{name}}` placeholders are filled from `params`. A placeholder without a
 *   param throws (the error names the template and the placeholder, never a
 *   value): a misnamed param is a bug the caller must see in development and
 *   tests, not an empty hole in a mail. An empty string is a value.
 * - The HTML is deliberately minimal: one `<p>` per non-empty line of the
 *   text, with every value escaped. The text is split into lines before the
 *   values go in, so a value cannot add paragraphs. A value that starts with
 *   `https://` is written as a link (`<a href>` with the escaped URL as href
 *   and text) so it is clickable in every mail client; the plain text keeps
 *   it as written.
 * - The subject is a single line, so line breaks in a value (an organization
 *   name is typed by a person) cannot reach the header.
 * - An unknown locale falls back to `sr-Latn`, the platform default.
 */
import { EMAIL_TEMPLATES } from './email-templates.js';
import type { MailMessage, MailTemplate } from './mailer.js';

const FALLBACK_LOCALE = 'sr-Latn';

/** `split` with this keeps the captured name at every odd index. */
const PLACEHOLDER = /\{\{(\w+)\}\}/;

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]!);
}

/** How one rendering (subject, text or html) writes the fixed copy and the values. */
interface Writer {
  fixed(copy: string): string;
  value(value: string): string;
}

const PLAIN: Writer = { fixed: (copy) => copy, value: (value) => value };

const HTML: Writer = {
  fixed: escapeHtml,
  value: (value) => {
    const escaped = escapeHtml(value);
    return value.startsWith('https://') ? `<a href="${escaped}">${escaped}</a>` : escaped;
  },
};

/** Fills the placeholders of `copy`, a piece of `template`'s text; throws for a placeholder without a param. */
function fill(
  copy: string,
  template: MailTemplate,
  params: Record<string, string>,
  writer: Writer,
): string {
  return copy
    .split(PLACEHOLDER)
    .map((part, index) => {
      if (index % 2 === 0) return writer.fixed(part);
      const value = Object.hasOwn(params, part) ? params[part] : undefined;
      if (value === undefined) {
        throw new Error(`Mail template ${template} needs the param ${part}`);
      }
      return writer.value(value);
    })
    .join('');
}

export function renderMail(message: MailMessage): { subject: string; text: string; html: string } {
  const byLocale = EMAIL_TEMPLATES[message.template];
  const copy = Object.hasOwn(byLocale, message.locale)
    ? byLocale[message.locale]
    : byLocale[FALLBACK_LOCALE];
  const { template, params } = message;

  return {
    subject: fill(copy.subject, template, params, PLAIN).replace(/\s+/g, ' ').trim(),
    text: fill(copy.text, template, params, PLAIN),
    html: copy.text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `<p>${fill(line, template, params, HTML)}</p>`)
      .join('\n'),
  };
}
