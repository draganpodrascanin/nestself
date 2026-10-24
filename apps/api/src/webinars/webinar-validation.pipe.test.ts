/**
 * The occurrence form's validation (WBN-30, D-CW-36): a capacity above 250
 * answers the coded 400 `capacity_above_limit`; anything else is the plain
 * validation failure.
 */
import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  WEBINAR_SINGLE_MEETING_CAPACITY,
  WebinarCreateRequestSchema,
  WebinarUpdateRequestSchema,
} from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { WebinarFormValidationPipe } from './webinar-validation.pipe.js';

const valid = {
  title: { en: 'Planning a balanced working week' },
  startsAt: '2026-11-25T16:00:00.000Z',
  endsAt: '2026-11-25T17:00:00.000Z',
  timeZone: 'Europe/Belgrade',
  audiencePolicy: { type: 'all_eligible' },
};

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('WebinarFormValidationPipe', () => {
  const create = new WebinarFormValidationPipe(WebinarCreateRequestSchema);
  const update = new WebinarFormValidationPipe(WebinarUpdateRequestSchema);

  it('answers 400 capacity_above_limit with the limit for a capacity of 300', () => {
    for (const [pipe, body] of [
      [create, { ...valid, capacity: 300 }],
      [update, { capacity: 300 }],
    ] as const) {
      const error = thrown(() => pipe.transform(body));
      expect(error).toBeInstanceOf(ApiHttpException);
      expect((error as ApiHttpException).getStatus()).toBe(400);
      expect((error as ApiHttpException).code).toBe('capacity_above_limit');
      expect((error as ApiHttpException).details).toEqual({ field: 'capacity', limit: WEBINAR_SINGLE_MEETING_CAPACITY });
    }
  });

  it('accepts the limit itself and defaults the capacity to it', () => {
    expect(create.transform({ ...valid, capacity: WEBINAR_SINGLE_MEETING_CAPACITY })).toMatchObject({ capacity: 250 });
    expect(create.transform(valid)).toMatchObject({ capacity: 250, presenterUserIds: [], moderatorUserId: null });
  });

  it('keeps every other failure a plain validation error, a recording switch included (D-CW-34)', () => {
    expect(thrown(() => create.transform({ ...valid, capacity: 0 }))).toBeInstanceOf(BadRequestException);
    expect(thrown(() => create.transform({ ...valid, recordingPolicy: 'off' }))).toBeInstanceOf(BadRequestException);
  });
});
