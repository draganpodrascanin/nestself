import { z } from 'zod';

export const supportAreas = ['psychological', 'legal', 'financial'] as const;
export const SupportAreaSchema = z.enum(supportAreas);
export type SupportArea = z.infer<typeof SupportAreaSchema>;

/** Maps a support area to the token icon category (tokens.json iconMapping). */
export const supportAreaIcon = {
  psychological: 'mentalSupport',
  legal: 'legal',
  financial: 'financial',
} as const;
