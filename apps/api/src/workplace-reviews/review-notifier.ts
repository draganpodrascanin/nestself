/**
 * ReviewNotifier: the module's emails (spec OPS-01, ADR 0002 D-EL-05).
 * Neutral copy and authenticated links, sent after the transaction that
 * justifies them has committed; logs carry the template, the locale and the
 * recipient's domain. No result, price or finding travels by mail.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { LocaleSchema, defaultLocale, type Locale } from '@nestself/contracts';
import { surfaceOrigin } from '../auth/sso-start-url.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityRepository } from '../db/repositories/identity.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { Mailer, recipientDomain, type MailInput } from '../mailer/mailer.js';

function toLocale(value: string | null | undefined): Locale {
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultLocale;
}

export interface BookedMeeting {
  id: string;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
}

@Injectable()
export class ReviewNotifier {
  private readonly logger = new Logger(ReviewNotifier.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: Mailer,
    private readonly identity: IdentityRepository,
    private readonly organizations: OrganizationsRepository,
  ) {}

  requestUrl(requestId: string): string {
    return `${surfaceOrigin(this.config, 'workspace')}/listening/reviews/${requestId}`;
  }

  engagementUrl(engagementId: string): string {
    return `${surfaceOrigin(this.config, 'workspace')}/listening/reviews/engagements/${engagementId}`;
  }

  /** The reviewer's own page of the engagement, in the admin app's expert area. */
  reviewerEngagementUrl(engagementId: string): string {
    return `${surfaceOrigin(this.config, 'admin')}/reviews/engagements/${engagementId}`;
  }

  async organizationName(orgId: string): Promise<string> {
    return (await this.organizations.findById(orgId))?.name ?? 'your organization';
  }

  async requestUpdate(orgId: string, requestId: string, requesterUserId: string, status: string): Promise<boolean> {
    const organizationName = await this.organizationName(orgId);
    return this.sendTo(requesterUserId, (locale) => ({ template: 'review_request_update', locale, data: { organizationName, status, requestUrl: this.requestUrl(requestId) } }));
  }

  async scopeSent(orgId: string, requestId: string, requesterUserId: string, validUntil: Date): Promise<boolean> {
    const [organizationName, org] = await Promise.all([this.organizationName(orgId), this.organizations.findById(orgId)]);
    return this.sendTo(requesterUserId, (locale) => ({
      template: 'review_scope_sent',
      locale,
      data: { organizationName, validUntil: validUntil.toISOString(), timeZone: org?.timezone ?? 'Europe/Belgrade', requestUrl: this.requestUrl(requestId) },
    }));
  }

  /** `review_booked` to the employer participant and the reviewer, each with the calendar file. */
  async booked(orgId: string, engagementId: string, meeting: BookedMeeting, participantUserId: string, reviewerUserId: string): Promise<number> {
    const organizationName = await this.organizationName(orgId);
    const appointment = { id: meeting.id, startsAt: meeting.startsAt.toISOString(), endsAt: meeting.endsAt.toISOString(), timeZone: meeting.timeZone };
    let sent = 0;
    if (await this.sendTo(participantUserId, (locale) => ({ template: 'review_booked', locale, data: { organizationName, appointment, engagementUrl: this.engagementUrl(engagementId) } }))) sent += 1;
    if (await this.sendTo(reviewerUserId, (locale) => ({ template: 'review_booked', locale, data: { organizationName, appointment, engagementUrl: this.reviewerEngagementUrl(engagementId) } }))) sent += 1;
    return sent;
  }

  async reportShared(orgId: string, engagementId: string, requesterUserId: string): Promise<boolean> {
    const organizationName = await this.organizationName(orgId);
    return this.sendTo(requesterUserId, (locale) => ({ template: 'review_report_shared', locale, data: { organizationName, engagementUrl: this.engagementUrl(engagementId) } }));
  }

  private async sendTo(userId: string, build: (locale: Locale) => Omit<MailInput, 'to'>): Promise<boolean> {
    const user = await this.identity.findUserById(userId);
    if (!user) return false;
    const locale = toLocale(user.locale);
    const input = { ...build(locale), to: user.email } as MailInput;
    try {
      await this.mailer.send(input);
      return true;
    } catch (error) {
      this.logger.warn({ template: input.template, locale, domain: recipientDomain(user.email), error: error instanceof Error ? error.name : 'UnknownError' }, 'Review mail not sent');
      return false;
    }
  }
}
