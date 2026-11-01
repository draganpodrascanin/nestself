/**
 * ListeningNotifier: the module's emails (spec EMP-03, OPS-01). Neutral copy,
 * authenticated links, one send per recipient after the transaction that
 * justifies it has committed. Logs carry the template, the locale and the
 * recipient's domain, never an address or a participation.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { LocaleSchema, defaultLocale, type Locale } from '@nestself/contracts';
import { surfaceOrigin } from '../auth/sso-start-url.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { Mailer, recipientDomain } from '../mailer/mailer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository, type CycleRow } from './listening.repository.js';

export function toLocale(value: string | null | undefined): Locale {
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultLocale;
}

export interface SurveyMailRecipient {
  email: string;
  locale: string;
}

@Injectable()
export class ListeningNotifier {
  private readonly logger = new Logger(ListeningNotifier.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: Mailer,
    private readonly repo: ListeningRepository,
    private readonly organizations: OrganizationsRepository,
  ) {}

  /** The survey page of the workspace app. */
  surveyUrl(): string {
    return `${surfaceOrigin(this.config, 'workspace')}/survey`;
  }

  /** Mails `survey_invitation` to every participant of a freshly launched cycle; each failure is logged. */
  async invitations(cycle: CycleRow): Promise<number> {
    const [org, recipients] = await Promise.all([this.organizations.findById(cycle.orgId), this.repo.findInvitationRecipients(cycle.id)]);
    let sent = 0;
    for (const recipient of recipients) {
      if (await this.send('survey_invitation', recipient, cycle, org?.name ?? 'your organization', org?.timezone ?? 'Europe/Belgrade')) sent += 1;
    }
    return sent;
  }

  /** Mails one `survey_reminder`; true when the mailer accepted it. */
  async reminder(cycle: CycleRow, recipient: SurveyMailRecipient, organizationName: string, timeZone: string): Promise<boolean> {
    return this.send('survey_reminder', recipient, cycle, organizationName, timeZone);
  }

  private async send(
    template: 'survey_invitation' | 'survey_reminder',
    recipient: SurveyMailRecipient,
    cycle: CycleRow,
    organizationName: string,
    timeZone: string,
  ): Promise<boolean> {
    const locale = toLocale(recipient.locale);
    try {
      await this.mailer.send({
        to: recipient.email,
        locale,
        template,
        data: { organizationName, closesAt: cycle.closesAt.toISOString(), timeZone, surveyUrl: this.surveyUrl() },
      });
      return true;
    } catch (error) {
      this.logger.warn(
        { template, locale, domain: recipientDomain(recipient.email), cycleId: cycle.id, error: error instanceof Error ? error.name : 'UnknownError' },
        'Survey mail not sent',
      );
      return false;
    }
  }
}
