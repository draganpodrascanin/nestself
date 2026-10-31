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
  'req.body.oidcClientSecret',
  'req.body.verificationToken',
  'req.body.handle',

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
  '*.oidcClientSecret',
  '*.verificationToken',
  '*.challengeToken',
  '*.handle',
];

export const PINO_REDACT_CONFIG = {
  paths: PINO_REDACT_PATHS,
  censor: '[redacted]',
} as const;
