/**
 * The occurrence form's validation (WBN-30, D-CW-14, T-CW-3.2): a capacity
 * above 1,000 answers the coded 400 `capacity_above_limit`; anything else is
 * the plain validation failure.
 */
import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  WEBINAR_REPLICATED_CAPACITY,
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

  it('answers 400 capacity_above_limit with the limit for a capacity of 1,001, without a milestone note', () => {
    for (const [pipe, body] of [
      [create, { ...valid, capacity: WEBINAR_REPLICATED_CAPACITY + 1 }],
      [update, { capacity: WEBINAR_REPLICATED_CAPACITY + 1 }],
    ] as const) {
      const error = thrown(() => pipe.transform(body));
      expect(error).toBeInstanceOf(ApiHttpException);
      expect((error as ApiHttpException).getStatus()).toBe(400);
      expect((error as ApiHttpException).code).toBe('capacity_above_limit');
      expect((error as ApiHttpException).details).toEqual({ field: 'capacity', limit: WEBINAR_REPLICATED_CAPACITY });
      expect((error as ApiHttpException).message).not.toMatch(/M3/);
    }
  });

  it('accepts a replicated audience up to the limit and defaults the capacity to one meeting', () => {
    expect(create.transform({ ...valid, capacity: 500 })).toMatchObject({ capacity: 500 });
    expect(update.transform({ capacity: WEBINAR_REPLICATED_CAPACITY })).toEqual({ capacity: WEBINAR_REPLICATED_CAPACITY });
    expect(create.transform(valid)).toMatchObject({
      capacity: WEBINAR_SINGLE_MEETING_CAPACITY,
      presenterUserIds: [],
      moderatorUserId: null,
    });
  });

  it('keeps every other failure a plain validation error, a recording switch included (D-CW-34)', () => {
    expect(thrown(() => create.transform({ ...valid, capacity: 0 }))).toBeInstanceOf(BadRequestException);
    expect(thrown(() => create.transform({ ...valid, recordingPolicy: 'off' }))).toBeInstanceOf(BadRequestException);
  });
});
