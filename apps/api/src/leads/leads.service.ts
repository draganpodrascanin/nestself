import { Injectable } from '@nestjs/common';
import type { Lead, LeadAccepted } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { LeadsRepository } from '../db/repositories/leads.repository.js';

const KIND_MAP = {
  demo_request: 'DEMO_REQUEST',
  contact: 'CONTACT',
  webinar_registration: 'WEBINAR_REGISTRATION',
} as const;

@Injectable()
export class LeadsService {
  constructor(private readonly leads: LeadsRepository) {}

  async accept(lead: Lead): Promise<LeadAccepted> {
    // Honeypot: if website is filled, return a fake-looking but valid response without storing
    if (lead.website) {
      return {
        id: `lead_${Date.now()}`,
        kind: lead.kind,
        receivedAt: new Date().toISOString(),
      };
    }

    // Strip known columns from the payload; the rest goes into the JSON column
    const { consent: _consent, website: _website, kind, email, locale, source, ...payload } = lead;

    const record = await this.leads.insert({
      kind: KIND_MAP[kind],
      email,
      locale,
      source: source ?? null,
      payload,
    });

    // TODO(queue): enqueue a notification job here once BullMQ is wired (REDIS_URL).

    return {
      id: record.id,
      kind,
      receivedAt: record.createdAt.toISOString(),
    };
  }
}
