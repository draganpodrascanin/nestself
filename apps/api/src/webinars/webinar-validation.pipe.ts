/**
 * Validation pipe of the occurrence form (`POST` and `PATCH /ops/webinars`,
 * WBN-30, D-CW-14). The contract refines `capacity` at
 * `WEBINAR_REPLICATED_CAPACITY` (1,000, media replication above 250,
 * T-CW-3.2) with the issue message
 * `capacity_above_limit`; this pipe turns that issue into the coded 400 the
 * clients map to translated copy, with the limit in `details`, the way the
 * services raise every other coded 400 (`ApiHttpException`). Any other issue
 * is the plain validation failure of `ZodValidationPipe`.
 */
import { Injectable, type PipeTransform } from '@nestjs/common';
import { WEBINAR_REPLICATED_CAPACITY, type CallErrorCode } from '@nestself/contracts';
import type { ZodType } from 'zod';
import { ApiHttpException } from '../common/api-error.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';

const CAPACITY_ABOVE_LIMIT: CallErrorCode = 'capacity_above_limit';

@Injectable()
export class WebinarFormValidationPipe implements PipeTransform {
  private readonly fallback: ZodValidationPipe;

  constructor(private readonly schema: ZodType) {
    this.fallback = new ZodValidationPipe(schema);
  }

  transform(value: unknown): unknown {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    const aboveLimit = result.error.issues.some(
      (issue) => issue.path.length === 1 && issue.path[0] === 'capacity' && issue.message === CAPACITY_ABOVE_LIMIT,
    );
    if (aboveLimit) {
      throw new ApiHttpException({
        status: 400,
        code: CAPACITY_ABOVE_LIMIT,
        message: `A webinar holds at most ${WEBINAR_REPLICATED_CAPACITY} attendees`,
        details: { field: 'capacity', limit: WEBINAR_REPLICATED_CAPACITY },
      });
    }
    return this.fallback.transform(value);
  }
}
