import {
  type PipeTransform,
  Injectable,
  BadRequestException,
} from '@nestjs/common';
import type { ZodType } from 'zod';

@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Validation failed',
        issues: result.error.issues.map(({ path, message, code }) => ({
          path,
          message,
          code,
        })),
      });
    }
    return result.data;
  }
}
