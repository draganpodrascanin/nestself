/**
 * Turns a `MailMessage` into the subject, plain text and HTML that an adapter
 * delivers.
 *
 * - `{{name}}` placeholders are filled from `params`; a missing param becomes
 *   an empty string.
 * - The HTML is deliberately minimal: one `<p>` per non-empty line of the
 *   text, with every value escaped. The text is split into lines before the
 *   values go in, so a value cannot add paragraphs.
 * - The subject is a single line, so line breaks in a value (an organization
 *   name is typed by a person) cannot reach the header.
 * - An unknown locale falls back to `sr-Latn`, the platform default.
 */
import { EMAIL_TEMPLATES } from './email-templates.js';
import type { MailMessage } from './mailer.js';

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

const asWritten = (value: string): string => value;

/** Fills the placeholders of `template`; `escape` is applied to the fixed text and to every value. */
function fill(
  template: string,
  params: Record<string, string>,
  escape: (value: string) => string,
): string {
  return template
    .split(PLACEHOLDER)
    .map((part, index) => {
      if (index % 2 === 0) return escape(part);
      return escape(Object.hasOwn(params, part) ? (params[part] ?? '') : '');
    })
    .join('');
}

export function renderMail(message: MailMessage): { subject: string; text: string; html: string } {
  const byLocale = EMAIL_TEMPLATES[message.template];
  const copy = Object.hasOwn(byLocale, message.locale)
    ? byLocale[message.locale]
    : byLocale[FALLBACK_LOCALE];
  const { params } = message;

  return {
    subject: fill(copy.subject, params, asWritten).replace(/\s+/g, ' ').trim(),
    text: fill(copy.text, params, asWritten),
    html: copy.text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => `<p>${fill(line, params, escapeHtml)}</p>`)
      .join('\n'),
  };
}
