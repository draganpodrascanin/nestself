import { describe, it, expect } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { PINO_REDACT_CONFIG } from './pino-redaction.js';

function captureLog(fn: (logger: pino.Logger) => void): string {
  let output = '';
  const dest = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString();
      callback();
    },
  });
  const logger = pino({ redact: PINO_REDACT_CONFIG }, dest);
  fn(logger);
  return output;
}

describe('pino-redaction', () => {
  const sensitiveValues = {
    password: 'super-secret-pw',
    newPassword: 'new-secret-pw',
    code: '123456',
    token: 'tok_abc',
    accessToken: 'at_xyz',
    idToken: 'id_xyz',
    refreshToken: 'rt_xyz',
    secret: 'sec_xyz',
  };

  it('redacts wildcard sensitive fields from nested objects', () => {
    // Wildcard paths like *.password match one nesting level, e.g. { nested: { password } }
    const output = captureLog((logger) => {
      logger.info({ nested: { ...sensitiveValues, safe: 'visible' } }, 'test');
    });

    expect(output).not.toContain('super-secret-pw');
    expect(output).not.toContain('new-secret-pw');
    expect(output).not.toContain('tok_abc');
    expect(output).not.toContain('at_xyz');
    expect(output).not.toContain('id_xyz');
    expect(output).not.toContain('rt_xyz');
    expect(output).not.toContain('sec_xyz');
    expect(output).toContain('visible');
    expect(output).toContain('[redacted]');
  });

  it('redacts the SSO client secret and domain verification token in bodies and nested objects', () => {
    const output = captureLog((logger) => {
      logger.info(
        {
          req: { body: { oidcClientSecret: 'oidc_sec_1', verificationToken: 'vt_1' } },
          nested: { oidcClientSecret: 'oidc_sec_2', verificationToken: 'vt_2', safe: 'visible' },
        },
        'test',
      );
    });
    for (const v of ['oidc_sec_1', 'vt_1', 'oidc_sec_2', 'vt_2']) expect(output).not.toContain(v);
    expect(output).toContain('visible');
  });

  it('redacts req.headers.authorization', () => {
    const output = captureLog((logger) => {
      logger.info(
        {
          req: {
            headers: { authorization: 'Bearer secret-token' },
          },
        },
        'request',
      );
    });

    expect(output).not.toContain('secret-token');
    expect(output).toContain('[redacted]');
  });

  it('redacts req.body sensitive fields', () => {
    const output = captureLog((logger) => {
      logger.info(
        {
          req: {
            body: {
              password: 'my-pass',
              challengeToken: 'chall-tok',
              intakeText: 'private-intake',
              messageBody: 'private-msg',
              professionalNotes: 'private-notes',
              voucherCode: 'voucher123',
              safeField: 'visible',
            },
          },
        },
        'request',
      );
    });

    expect(output).not.toContain('my-pass');
    expect(output).not.toContain('chall-tok');
    expect(output).not.toContain('private-intake');
    expect(output).not.toContain('private-msg');
    expect(output).not.toContain('private-notes');
    expect(output).not.toContain('voucher123');
    expect(output).toContain('visible');
  });

  it('redacts new req.body fields: tokens, conversationBody, professionalNote, emailAddress', () => {
    const output = captureLog((logger) => {
      logger.info(
        {
          req: {
            body: {
              tokens: 'secret-tokens-obj',
              conversationBody: 'private-conversation',
              professionalNote: 'clinical-note',
              emailAddress: 'person@example.com',
              safeField: 'visible',
            },
          },
        },
        'request',
      );
    });

    expect(output).not.toContain('secret-tokens-obj');
    expect(output).not.toContain('private-conversation');
    expect(output).not.toContain('clinical-note');
    expect(output).not.toContain('person@example.com');
    expect(output).toContain('visible');
  });

  it('redacts new wildcard paths: *.tokens, *.emailAddress, *.conversationBody, *.professionalNote', () => {
    const output = captureLog((logger) => {
      logger.info({
        nested: {
          tokens: 'secret-tok',
          emailAddress: 'hidden@example.com',
          conversationBody: 'hidden-chat',
          professionalNote: 'hidden-note',
          safeField: 'visible',
        },
      }, 'test');
    });

    expect(output).not.toContain('secret-tok');
    expect(output).not.toContain('hidden@example.com');
    expect(output).not.toContain('hidden-chat');
    expect(output).not.toContain('hidden-note');
    expect(output).toContain('visible');
  });

  it('redacts Chime join tokens at any depth up to the join response body (CW-R-69, T-CW-1.1)', () => {
    const output = captureLog((logger) => {
      logger.info(
        {
          JoinToken: 'jt-top',
          joinToken: 'jt-top-lower',
          attendee: { JoinToken: 'jt-attendee', AttendeeId: 'attendee-visible' },
          credentials: { attendee: { JoinToken: 'jt-credentials' } },
          res: { body: { attendee: { JoinToken: 'jt-response', joinToken: 'jt-response-lower' } } },
          nested: { joinToken: 'jt-nested' },
        },
        'join',
      );
    });

    for (const token of ['jt-top', 'jt-attendee', 'jt-credentials', 'jt-response', 'jt-nested']) {
      expect(output).not.toContain(token);
    }
    expect(output).toContain('attendee-visible');
    expect(output).toContain('[redacted]');
  });

  it('redacts the location text an employee shares before a consultation (CALL-34)', () => {
    const output = captureLog((logger) => {
      logger.info({ req: { body: { locationText: 'Novi Sad, at home' } }, session: { locationText: 'Subotica' } }, 'join');
    });
    expect(output).not.toContain('Novi Sad');
    expect(output).not.toContain('Subotica');
  });
});
