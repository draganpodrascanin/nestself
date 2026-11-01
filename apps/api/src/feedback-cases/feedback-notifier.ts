/**
 * FeedbackNotifier: the module's emails (spec FBK-02). Neutral copy with an
 * authenticated link and never a line of case content; one send per recipient
 * after the transaction that justifies it has committed. The reporter's
 * address is resolved through the restricted reporter link and used for the
 * send only; logs carry the template, the locale and the recipient's domain.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { LocaleSchema, defaultLocale, type Locale } from '@nestself/contracts';
import { surfaceOrigin } from '../auth/sso-start-url.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityRepository } from '../db/repositories/identity.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OrganizationsRepository } from '../db/repositories/organizations.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { Mailer, recipientDomain } from '../mailer/mailer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { FeedbackCasesRepository, type CaseRow } from './feedback-cases.repository.js';

function toLocale(value: string | null | undefined): Locale {
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultLocale;
}

@Injectable()
export class FeedbackNotifier {
  private readonly logger = new Logger(FeedbackNotifier.name);

  constructor(
    private readonly config: ConfigService,
    private readonly mailer: Mailer,
    private readonly dbs: DbService,
    private readonly repo: FeedbackCasesRepository,
    private readonly identity: IdentityRepository,
    private readonly organizations: OrganizationsRepository,
  ) {}

  /** The handler's inbox page for the case. */
  inboxUrl(caseId: string): string {
    return `${surfaceOrigin(this.config, 'workspace')}/feedback/inbox/${caseId}`;
  }

  /** The reporter's own page for the case. */
  caseUrl(caseId: string): string {
    return `${surfaceOrigin(this.config, 'workspace')}/feedback/cases/${caseId}`;
  }

  /** `feedback_case_assigned` to the handler who now owns the case, and to no one else. */
  async assigned(row: CaseRow, handlerUserId: string): Promise<boolean> {
    const [user, org] = await Promise.all([this.identity.findUserById(handlerUserId), this.organizations.findById(row.orgId)]);
    if (!user) return false;
    const locale = toLocale(user.locale);
    try {
      await this.mailer.send({
        to: user.email,
        locale,
        template: 'feedback_case_assigned',
        data: { pseudonym: row.pseudonym, dueAt: row.dueAt ? row.dueAt.toISOString() : null, timeZone: org?.timezone ?? 'Europe/Belgrade', caseUrl: this.inboxUrl(row.id) },
      });
      return true;
    } catch (error) {
      this.warn('feedback_case_assigned', locale, user.email, row.id, error);
      return false;
    }
  }

  /** `feedback_case_update` to the handler: a reporter wrote on the case. */
  async updateForHandler(row: CaseRow, handlerUserId: string): Promise<boolean> {
    const user = await this.identity.findUserById(handlerUserId);
    if (!user) return false;
    return this.update(user.email, user.locale, row, this.inboxUrl(row.id));
  }

  /** `feedback_case_update` to the reporter, resolved through the restricted link. */
  async updateForReporter(row: CaseRow): Promise<boolean> {
    const reporterUserId = await this.dbs.withOrgScope(row.orgId, (tx) => this.repo.findReporterUserId(row.id, tx));
    if (!reporterUserId) return false;
    const user = await this.identity.findUserById(reporterUserId);
    if (!user) return false;
    return this.update(user.email, user.locale, row, this.caseUrl(row.id));
  }

  private async update(email: string, localeValue: string | null, row: CaseRow, caseUrl: string): Promise<boolean> {
    const locale = toLocale(localeValue);
    try {
      await this.mailer.send({ to: email, locale, template: 'feedback_case_update', data: { pseudonym: row.pseudonym, caseUrl } });
      return true;
    } catch (error) {
      this.warn('feedback_case_update', locale, email, row.id, error);
      return false;
    }
  }

  private warn(template: string, locale: Locale, email: string, caseId: string, error: unknown): void {
    this.logger.warn({ template, locale, domain: recipientDomain(email), caseId, error: error instanceof Error ? error.name : 'UnknownError' }, 'Feedback mail not sent');
  }
}
