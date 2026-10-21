import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'production', 'test'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('1h'),
  REDIS_URL: z.string().url().optional(),
  MARKETING_URL: z.string().url().optional(),
  WORKSPACE_URL: z.string().url().optional(),
  ADMIN_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  return envSchema.parse(config) as unknown as Record<string, unknown>;
}
