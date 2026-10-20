import { z } from 'zod';

export const locales = ['en', 'sr-Latn', 'sr-Cyrl'] as const;
export const LocaleSchema = z.enum(locales);
export type Locale = z.infer<typeof LocaleSchema>;
export const defaultLocale: Locale = 'en';
