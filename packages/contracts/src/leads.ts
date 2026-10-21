import { z } from 'zod';
import { LocaleSchema } from './locale.ts';

export const CompanySizeSchema = z.enum(['1-50', '51-200', '201-500', '501-1000', '1000+']);
export const HeardAboutSchema = z.enum(['search', 'referral', 'event', 'social', 'other']);

export const CountrySchema = z.enum(['RS', 'HU', 'OTHER']);

const Email = z.string().trim().toLowerCase().email().max(254);
const Text = (max: number) => z.string().trim().min(1).max(max);

const LeadBase = z.object({
  locale: LocaleSchema,
  consent: z.literal(true),
  /** Honeypot: humans never see this field; bots fill it. Accepted by the schema so the service can silently discard. */
  website: z.string().max(200).optional(),
  source: z.string().max(100).optional(),
});

export const DemoRequestSchema = LeadBase.extend({
  kind: z.literal('demo_request'),
  name: Text(120),
  email: Email,
  company: Text(160),
  companySize: CompanySizeSchema,
  country: CountrySchema,
  role: Text(120).optional(),
  message: z.string().trim().max(2000).optional(),
  heardAbout: HeardAboutSchema.optional(),
});

export const ContactMessageSchema = LeadBase.extend({
  kind: z.literal('contact'),
  name: Text(120),
  email: Email,
  subject: Text(160),
  message: Text(4000),
});

export const WebinarRegistrationSchema = LeadBase.extend({
  kind: z.literal('webinar_registration'),
  webinarSlug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .max(120),
  name: Text(120),
  email: Email,
  company: z.string().trim().max(160).optional(),
});

export const LeadSchema = z.discriminatedUnion('kind', [
  DemoRequestSchema,
  ContactMessageSchema,
  WebinarRegistrationSchema,
]);

export const LeadAcceptedSchema = z.object({
  id: z.string(),
  kind: z.enum(['demo_request', 'contact', 'webinar_registration']),
  receivedAt: z.string(),
});

export type DemoRequest = z.infer<typeof DemoRequestSchema>;
export type ContactMessage = z.infer<typeof ContactMessageSchema>;
export type WebinarRegistration = z.infer<typeof WebinarRegistrationSchema>;
export type Lead = z.infer<typeof LeadSchema>;
export type LeadAccepted = z.infer<typeof LeadAcceptedSchema>;
