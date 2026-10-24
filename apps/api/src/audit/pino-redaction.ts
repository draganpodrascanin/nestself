/**
 * Pino redaction paths for sensitive fields.
 *
 * Wire into LoggerModule pinoHttp config as `redact: PINO_REDACT_CONFIG`.
 *
 * @see D-21
 */

export const PINO_REDACT_PATHS: string[] = [
  // Headers
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',

  // Request body fields
  'req.body.password',
  'req.body.newPassword',
  'req.body.code',
  'req.body.response',
  'req.body.token',
  'req.body.tokens',
  'req.body.accessToken',
  'req.body.idToken',
  'req.body.refreshToken',
  'req.body.challengeToken',
  'req.body.secret',
  'req.body.intakeText',
  'req.body.messageBody',
  'req.body.conversationBody',
  'req.body.professionalNotes',
  'req.body.professionalNote',
  'req.body.emailAddress',
  'req.body.voucherCode',
  // Crisis-readiness location shared before a psychological consultation (CALL-34)
  'req.body.locationText',

  // Wildcard paths for nested objects
  '*.password',
  '*.newPassword',
  '*.code',
  '*.token',
  '*.tokens',
  '*.accessToken',
  '*.idToken',
  '*.refreshToken',
  '*.secret',
  '*.emailAddress',
  '*.conversationBody',
  '*.professionalNote',
  '*.locationText',

  // Chime SDK join tokens (CW-R-69, D-CW-08): top level and up to three
  // levels deep, which reaches `res.body.attendee.JoinToken` and the
  // `credentials.attendee.JoinToken` blob, in both spellings.
  'joinToken',
  'JoinToken',
  '*.joinToken',
  '*.JoinToken',
  '*.*.joinToken',
  '*.*.JoinToken',
  '*.*.*.joinToken',
  '*.*.*.JoinToken',
];

export const PINO_REDACT_CONFIG = {
  paths: PINO_REDACT_PATHS,
  censor: '[redacted]',
} as const;
