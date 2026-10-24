/**
 * Raw MIME message for SES `SendRawEmail`, built by hand (no dependency).
 *
 * Structure: `multipart/mixed` holding a `multipart/alternative` (text, then
 * HTML) and one part per attachment, for example
 * `text/calendar; charset=UTF-8; method=REQUEST`. Without attachments the
 * `multipart/alternative` is the whole message. Every body part is base64
 * with 76-character lines, the subject is an RFC 2047 encoded word, so the
 * message is 7-bit clean; every line ends with CRLF and stays within 78
 * characters (RFC 5322 section 2.1.1).
 */
import { randomBytes } from 'node:crypto';
import { type MailAttachment } from './templates/index.js';

export interface RawMessageInput {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  attachments?: MailAttachment[];
  date?: Date;
}

const CRLF = '\r\n';
const MAX_HEADER_LINE = 78;
/** 39 octets of UTF-8 become 52 base64 characters: "Subject: =?UTF-8?B?…?=" stays within 78. */
const ENCODED_WORD_OCTETS = 39;

/** One bare address: no display name, no list, no line break. */
const SINGLE_ADDRESS = /^[^\s@,;:<>()[\]"\\]+@[^\s@,;:<>()[\]"\\]+\.[^\s@,;:<>()[\]"\\]+$/;

export function isSingleAddress(value: string): boolean {
  return SINGLE_ADDRESS.test(value);
}

function toCrlf(value: string): string {
  return value.replace(/\r\n|\r|\n/g, CRLF);
}

function base64Lines(content: string): string {
  const encoded = Buffer.from(content, 'utf8').toString('base64');
  return (encoded.match(/.{1,76}/g) ?? ['']).join(CRLF);
}

/** RFC 2047 B-encoded words, split on code point boundaries and folded. */
function encodeSubject(subject: string): string {
  const words: string[] = [];
  let chunk = '';
  for (const char of subject) {
    if (Buffer.byteLength(chunk + char, 'utf8') > ENCODED_WORD_OCTETS) {
      words.push(chunk);
      chunk = char;
    } else {
      chunk += char;
    }
  }
  if (chunk || words.length === 0) words.push(chunk);
  return words.map((word) => `=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`).join(`${CRLF} `);
}

/** A structured header, folded between its `;`-separated parameters when too long. */
function header(name: string, value: string): string {
  const [first, ...params] = value.split('; ');
  const lines: string[] = [];
  let line = `${name}: ${first}`;
  for (const param of params) {
    if (line.length + 2 + param.length > MAX_HEADER_LINE) {
      lines.push(`${line};`);
      line = ` ${param}`;
    } else {
      line += `; ${param}`;
    }
  }
  lines.push(line);
  return lines.join(CRLF);
}

function rfc5322Date(date: Date): string {
  return date.toUTCString().replace(/GMT$/, '+0000');
}

function boundary(kind: string): string {
  // "=_" never occurs in base64 or in the header text, so it cannot collide.
  return `=_NestSelf_${kind}_${randomBytes(12).toString('hex')}`;
}

function part(headers: string[], body: string): string {
  return [...headers, '', body].join(CRLF);
}

function multipart(type: string, parts: string[]): { contentType: string; body: string } {
  const marker = boundary(type.split('/')[1]!);
  const body = [...parts.map((p) => `--${marker}${CRLF}${p}`), `--${marker}--`].join(CRLF);
  return { contentType: `${type}; boundary="${marker}"`, body };
}

export function buildRawMessage(input: RawMessageInput): string {
  if (!isSingleAddress(input.from)) throw new Error('Invalid sender address');
  if (!isSingleAddress(input.to)) throw new Error('Invalid recipient address');

  const alternative = multipart('multipart/alternative', [
    part(['Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'], base64Lines(toCrlf(input.text))),
    part(['Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64'], base64Lines(toCrlf(input.html))),
  ]);

  const attachments = input.attachments ?? [];
  const root =
    attachments.length === 0
      ? alternative
      : multipart('multipart/mixed', [
          part([header('Content-Type', alternative.contentType)], alternative.body),
          ...attachments.map((attachment) => {
            const filename = attachment.filename.replace(/[^A-Za-z0-9._-]/g, '_');
            return part(
              [
                header('Content-Type', `${attachment.contentType}; name="${filename}"`),
                header('Content-Disposition', `attachment; filename="${filename}"`),
                'Content-Transfer-Encoding: base64',
              ],
              base64Lines(attachment.content),
            );
          }),
        ]);

  return (
    [
      `From: ${input.from}`,
      `To: ${input.to}`,
      `Subject: ${encodeSubject(input.subject.replace(/[\r\n]+/g, ' '))}`,
      `Date: ${rfc5322Date(input.date ?? new Date())}`,
      'MIME-Version: 1.0',
      header('Content-Type', root.contentType),
      '',
      root.body,
    ].join(CRLF) + CRLF
  );
}
