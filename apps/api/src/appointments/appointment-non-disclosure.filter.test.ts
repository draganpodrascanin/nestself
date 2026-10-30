import { describe, expect, it } from 'vitest';
import type { ArgumentsHost } from '@nestjs/common';
import { ApiHttpException } from '../common/api-error.js';
import { AppointmentNonDisclosureFilter, ParticipantForbiddenException } from './appointment-non-disclosure.filter.js';

function respond(exception: ApiHttpException): { status: number; body: Record<string, unknown> } {
  const sent: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = {
    headersSent: false,
    setHeader: () => undefined,
    status(code: number) {
      sent.status = code;
      return res;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({ getRequest: () => ({ headers: {} }), getResponse: () => res }),
  } as unknown as ArgumentsHost;
  new AppointmentNonDisclosureFilter().catch(exception, host);
  return sent;
}

describe('AppointmentNonDisclosureFilter', () => {
  it('answers an authorization denial or a context mismatch with the not-found envelope (CALL-17, D-CW-30)', () => {
    for (const code of ['forbidden', 'context_mismatch']) {
      const sent = respond(new ApiHttpException({ status: 403, code, message: 'Access denied' }));
      expect(sent.status, code).toBe(404);
      expect(sent.body).toMatchObject({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
  });

  it('keeps a participant denial raised by a service as a 403 (T-CW-1.1)', () => {
    const sent = respond(new ParticipantForbiddenException('Only the expert can end the session'));
    expect(sent.status).toBe(403);
    expect(sent.body).toMatchObject({ status: 403, code: 'forbidden', message: 'Only the expert can end the session' });
  });

  it('keeps every other error as it is', () => {
    for (const [status, code] of [
      [403, 'session_required'],
      [403, 'step_up_required'],
      [403, 'join_window_closed'],
      [409, 'appointment_not_joinable'],
      [400, 'validation'],
    ] as const) {
      const sent = respond(new ApiHttpException({ status, code, message: 'x' }));
      expect(sent.status).toBe(status);
      expect(sent.body).toMatchObject({ status, code });
    }
  });
});
