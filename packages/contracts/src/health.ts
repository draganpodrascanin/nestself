import { z } from 'zod';

/** Mirrors @nestjs/terminus output. */
export const HealthResponseSchema = z.object({
  status: z.enum(['ok', 'error', 'shutting_down']),
  info: z
    .record(z.string(), z.object({ status: z.string() }).loose())
    .optional(),
  error: z
    .record(z.string(), z.object({ status: z.string() }).loose())
    .optional(),
  details: z
    .record(z.string(), z.object({ status: z.string() }).loose())
    .optional(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
