/**
 * WebinarMailer: the webinar emails (WBN-04, WBN-05, WBN-32, D-CW-26,
 * D-CW-34): the registration confirmation with the recording notice, the
 * reminder and the cancellation, each in the recipient's locale with the
 * neutral subject and a calendar file keyed by the registration. No title or
 * topic is ever in an email.
 *
 * Sending is best effort and never throws: the registration or the
 * cancellation is already committed, and a failure is logged with ids only.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { LocaleSchema, defaultLocale, type Locale } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { IdentityRepository } from '../db/repositories/identity.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { Mailer } from '../mailer/mailer.js';
import type { WebinarRecord } from './webinars.repository.js';

type Window = Pick<WebinarRecord, 'id' | 'startsAt' | 'endsAt' | 'timeZone'>;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

function localeOf(value: string | null | undefined): Locale {
  const parsed = LocaleSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultLocale;
}

@Injectable()
export class WebinarMailer {
  private readonly logger = new Logger(WebinarMailer.name);

  constructor(
    private readonly mailer: Mailer,
    private readonly identities: IdentityRepository,
    private readonly config: ConfigService,
  ) {}

  /** `webinar.registration`: the confirmation with the recording notice (WBN-04, D-CW-34). */
  async registered(userId: string, registrationId: string, webinar: Window): Promise<boolean> {
    return this.send(userId, registrationId, 'registered', (to, locale) =>
      this.mailer.send({
        to,
        locale,
        template: 'webinar.registration',
        data: { registrationId, webinar: this.windowOf(webinar), joinUrl: this.webinarUrl(webinar.id) },
      }),
    );
  }

  /** `webinar.reminder` (WBN-05). */
  async reminder(userId: string, registrationId: string, webinar: Window): Promise<boolean> {
    return this.send(userId, registrationId, 'reminder', (to, locale) =>
      this.mailer.send({
        to,
        locale,
        template: 'webinar.reminder',
        data: { registrationId, webinar: this.windowOf(webinar), joinUrl: this.webinarUrl(webinar.id) },
      }),
    );
  }

  /** `webinar.canceled` (WBN-32). */
  async canceled(userId: string, registrationId: string, webinar: Window): Promise<boolean> {
    return this.send(userId, registrationId, 'canceled', (to, locale) =>
      this.mailer.send({
        to,
        locale,
        template: 'webinar.canceled',
        data: { registrationId, webinar: this.windowOf(webinar), webinarsUrl: this.webinarsUrl() },
      }),
    );
  }

  private async send(
    userId: string,
    registrationId: string,
    kind: string,
    deliver: (to: string, locale: Locale) => Promise<void>,
  ): Promise<boolean> {
    try {
      const user = await this.identities.findUserById(userId);
      if (!user || user.suspendedAt || user.deactivatedAt) return false;
      await deliver(user.email, localeOf(user.locale));
      return true;
    } catch (error) {
      this.logger.error({ registrationId, operation: `mail.${kind}`, error: errorName(error) }, 'Webinar email not sent');
      return false;
    }
  }

  private windowOf(webinar: Window) {
    return { startsAt: webinar.startsAt.toISOString(), endsAt: webinar.endsAt.toISOString(), timeZone: webinar.timeZone };
  }

  private workspaceUrl(): string {
    return this.config.get<string>('WORKSPACE_URL') ?? 'http://localhost:5173';
  }

  /** The authenticated webinar page in the workspace. */
  private webinarUrl(webinarId: string): string {
    return `${this.workspaceUrl()}/webinars/${encodeURIComponent(webinarId)}`;
  }

  private webinarsUrl(): string {
    return `${this.workspaceUrl()}/webinars`;
  }
}
