/**
 * WebinarOpsService: the occurrence form and the operations views
 * (T-CW-2.1, WBN-30 to WBN-33, D-CW-14, D-CW-17, D-CW-34, D-CW-36).
 *
 * - Create and edit (`POST`, `PATCH /ops/webinars`, `event.manage`): title
 *   and description per locale, schedule, audience policy, capacity (at most
 *   `WEBINAR_SINGLE_MEETING_CAPACITY` until M3: 400 `capacity_above_limit`),
 *   presenters and the moderator. No recording field: every webinar is
 *   recorded. A new occurrence is `draft`; editing is allowed while `draft`
 *   or `published`. The occurrence takes the organisation its audience names
 *   (CW-R-23); changing it needs `event.manage` on the new organisation too.
 *   Each presenter gets a CASE assignment on the occurrence, so the `expert`
 *   template's `event.present` reaches it; a removed presenter's assignment
 *   ends. A capacity below the active registrations is refused.
 * - Publish (WBN-31): at least one presenter and the moderator, a start in
 *   the future and an audience that names at least one active organisation.
 * - Cancel (WBN-32): from `draft` or `published`; every registrant's
 *   reminders are removed and the cancellation email goes out.
 * - List (`GET /ops/webinars`, an addition to the canonical route list for
 *   the admin index): the occurrences the caller may manage or moderate,
 *   every status, paged on `(startsAt, id)`.
 * - Attendance (`GET /ops/webinars/:id/attendance`, WBN-33, D-CW-17,
 *   D-CW-30): `event.manage` or `event.moderate` on the occurrence in the
 *   operations context; anyone else, an employer-scoped principal included,
 *   gets 404. Counts and one row per registration keyed by the registration
 *   id, from the provider's join and leave times on `call_participants`
 *   (T-CW-1.2): no name, email or user id.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  ACTIONS,
  WEBINAR_LIST_DEFAULT_LIMIT,
  WEBINAR_STATUSES,
  type Principal,
  type Webinar,
  type WebinarAttendanceResponse,
  type WebinarAudiencePolicy,
  type WebinarCreateRequest,
  type WebinarHostRole,
  type WebinarOpsListQuery,
  type WebinarOpsListResponse,
  type WebinarStatusResponse,
  type WebinarUpdateRequest,
} from '@nestself/contracts';
import { firstNameOf } from '../appointments/appointment-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter, type AuditEventInput } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
import { assertOperationsSession } from '../authz/resolvers.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarJobSchedulerService } from '../jobs/webinar-job-scheduler.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
import { assertCapacityWithinLimit } from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarAccess, conflict, invalidField } from './webinar-access.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarMailer } from './webinar-mailer.js';
import {
  attendedMinutes,
  completionPercent,
  decodePageCursor,
  occurrenceOrgId,
  paginate,
  peakConcurrent,
  type PresenceInterval,
} from './webinar-mapper.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarRoomEvents } from './webinar-room-events.js';
import { WEBINAR_RESOURCE_TYPE, webinarStaffResourceOf } from './webinar.resolver.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import {
  WebinarsRepository,
  type NewWebinarHost,
  type WebinarHostRecord,
  type WebinarPatch,
  type WebinarRecord,
} from './webinars.repository.js';

const MINUTE_MS = 60_000;

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'UnknownError';
}

/** The operations view of an occurrence with its hosts. */
export function toWebinar(webinar: WebinarRecord, hosts: readonly WebinarHostRecord[]): Webinar {
  return {
    id: webinar.id,
    orgId: webinar.orgId,
    title: webinar.title,
    description: webinar.description,
    audiencePolicy: webinar.audiencePolicy,
    capacity: webinar.capacity,
    startsAt: webinar.startsAt.toISOString(),
    endsAt: webinar.endsAt.toISOString(),
    timeZone: webinar.timeZone,
    status: webinar.status,
    chatPolicy: webinar.chatPolicy,
    createdByUserId: webinar.createdByUserId,
    hosts: hosts.map((host) => ({ userId: host.userId, role: host.role, displayName: host.displayName })),
  };
}

@Injectable()
export class WebinarOpsService {
  private readonly logger = new Logger(WebinarOpsService.name);

  constructor(
    private readonly repo: WebinarsRepository,
    private readonly access: WebinarAccess,
    private readonly authz: AuthorizationService,
    private readonly principals: PrincipalLoader,
    private readonly audit: AuditWriter,
    private readonly scheduler: WebinarJobSchedulerService,
    private readonly mail: WebinarMailer,
    private readonly events: WebinarRoomEvents,
  ) {}

  // ── List ──────────────────────────────────────────────────────────────────

  async list(principal: Principal, query: WebinarOpsListQuery): Promise<WebinarOpsListResponse> {
    assertOperationsSession(principal);
    const after = query.cursor ? decodePageCursor(query.cursor) : undefined;
    if (after === null) throw invalidField('cursor', 'The cursor is not valid');
    const limit = query.limit ?? WEBINAR_LIST_DEFAULT_LIMIT;

    const scope = await this.access.organisationsFor(principal, [ACTIONS['event.manage'], ACTIONS['event.moderate']]);
    if (scope !== null && scope.length === 0) return this.access.deny(principal, ACTIONS['event.manage'], null);
    let orgIds: string[] | null = scope;
    if (query.orgId) orgIds = scope === null || scope.includes(query.orgId) ? [query.orgId] : [];

    const rows = await this.repo.list({
      statuses: query.status ? [query.status] : WEBINAR_STATUSES,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      orgIds,
      after,
      limit: limit + 1,
    });
    const page = paginate(rows, limit, (webinar) => ({ at: webinar.startsAt, id: webinar.id }));
    const hosts = await this.repo.listHostsFor(page.items.map((webinar) => webinar.id));
    return { items: page.items.map((webinar) => toWebinar(webinar, hosts.get(webinar.id) ?? [])), nextCursor: page.nextCursor };
  }

  // ── Create and edit (WBN-30) ──────────────────────────────────────────────

  async create(body: WebinarCreateRequest, principal: Principal): Promise<Webinar> {
    assertCapacityWithinLimit('webinar', body.capacity);
    await this.assertAudience(body.audiencePolicy);
    const hosts = await this.hostsFor(body.presenterUserIds, body.moderatorUserId);
    const orgId = occurrenceOrgId(body.audiencePolicy);

    const { webinar, saved } = await this.access.transaction(orgId, async (tx) => {
      const created = await this.repo.create(
        {
          orgId,
          title: body.title,
          description: body.description ?? null,
          audiencePolicy: body.audiencePolicy,
          capacity: body.capacity,
          startsAt: new Date(body.startsAt),
          endsAt: new Date(body.endsAt),
          timeZone: body.timeZone,
          createdByUserId: principal.userId,
        },
        tx,
      );
      await this.repo.replaceHosts(created, hosts, tx);
      for (const userId of body.presenterUserIds) await this.repo.assignPresenter(created.id, userId, principal.userId, tx);
      return { webinar: created, saved: await this.repo.listHosts(created.id, tx) };
    });

    await this.record(principal.userId, webinar, 'webinar.created', { webinarId: webinar.id, createdByUserId: principal.userId });
    // The new CASE assignments must reach the presenters' next decision, not after the cache TTL.
    await this.invalidate(body.presenterUserIds);
    return toWebinar(webinar, saved);
  }

  async update(webinarId: string, body: WebinarUpdateRequest, principal: Principal): Promise<Webinar> {
    const current = await this.access.load(webinarId);
    if (current.status !== 'draft' && current.status !== 'published') {
      throw conflict('not_editable', 'Only a draft or published webinar can be edited');
    }
    if (body.capacity !== undefined) assertCapacityWithinLimit('webinar', body.capacity);

    const patch: WebinarPatch = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.timeZone !== undefined) patch.timeZone = body.timeZone;
    if (body.startsAt !== undefined) patch.startsAt = new Date(body.startsAt);
    if (body.endsAt !== undefined) patch.endsAt = new Date(body.endsAt);
    if ((patch.endsAt ?? current.endsAt).getTime() <= (patch.startsAt ?? current.startsAt).getTime()) {
      throw invalidField('endsAt', 'endsAt must be after startsAt');
    }
    if (body.audiencePolicy !== undefined) {
      await this.assertAudience(body.audiencePolicy);
      patch.audiencePolicy = body.audiencePolicy;
      patch.orgId = occurrenceOrgId(body.audiencePolicy);
      if (patch.orgId !== current.orgId) {
        // The guard checked the occurrence where it is; moving it needs the right where it goes.
        await this.authz.require(
          principal,
          ACTIONS['event.manage'],
          patch.orgId ? { type: WEBINAR_RESOURCE_TYPE, orgId: patch.orgId } : { type: WEBINAR_RESOURCE_TYPE },
        );
      }
    }
    if (body.capacity !== undefined) {
      const registered = await this.access.scoped(current.orgId, (tx) => this.repo.countActiveRegistrations(webinarId, tx));
      if (body.capacity < registered) {
        throw conflict('capacity_below_registrations', 'The capacity cannot be below the number of registrations');
      }
      patch.capacity = body.capacity;
    }

    let hosts: NewWebinarHost[] | null = null;
    if (body.presenterUserIds !== undefined || body.moderatorUserId !== undefined) {
      const before = await this.repo.listHosts(webinarId);
      const presenters = body.presenterUserIds ?? before.filter((h) => h.role === 'presenter').map((h) => h.userId);
      const moderator =
        body.moderatorUserId !== undefined ? body.moderatorUserId : (before.find((h) => h.role === 'moderator')?.userId ?? null);
      hosts = await this.hostsFor(presenters, moderator);
    }

    const orgChanged = patch.orgId !== undefined && patch.orgId !== current.orgId;
    // A move between organisations runs in the system context: the row leaves the old tenant's scope.
    const { webinar, saved, changed } = await this.access.transaction(orgChanged ? null : current.orgId, async (tx) => {
      const updated = (await this.repo.update(webinarId, patch, tx)) ?? current;
      if (orgChanged) await this.repo.setHostsOrg(webinarId, updated.orgId, tx);
      let presenters = { removedPresenters: [] as string[], addedPresenters: [] as string[] };
      if (hosts) {
        presenters = await this.repo.replaceHosts(updated, hosts, tx);
        for (const userId of presenters.addedPresenters) await this.repo.assignPresenter(webinarId, userId, principal.userId, tx);
        for (const userId of presenters.removedPresenters) await this.repo.unassignPresenter(webinarId, userId, tx);
      }
      return { webinar: updated, saved: await this.repo.listHosts(webinarId, tx), changed: presenters };
    });

    await this.invalidate([...changed.addedPresenters, ...changed.removedPresenters]);
    if (patch.startsAt && patch.startsAt.getTime() !== current.startsAt.getTime()) await this.rescheduleReminders(webinar);
    await this.record(principal.userId, webinar, 'webinar.updated', { webinarId, changedFields: Object.keys(body).sort() });
    return toWebinar(webinar, saved);
  }

  // ── Publish and cancel (WBN-31, WBN-32) ───────────────────────────────────

  async publish(webinarId: string, principal: Principal): Promise<WebinarStatusResponse> {
    const webinar = await this.access.load(webinarId);
    if (webinar.status === 'published') return { webinarId, status: 'published' };
    if (webinar.status !== 'draft') throw conflict('not_publishable', 'Only a draft webinar can be published');

    const hosts = await this.repo.listHosts(webinarId);
    if (!hosts.some((host) => host.role === 'presenter')) {
      throw invalidField('presenterUserIds', 'Publishing needs at least one presenter');
    }
    if (!hosts.some((host) => host.role === 'moderator')) throw invalidField('moderatorUserId', 'Publishing needs a moderator');
    if (webinar.startsAt.getTime() <= Date.now()) throw invalidField('startsAt', 'The webinar must start in the future');
    await this.assertAudience(webinar.audiencePolicy);

    const published = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.transitionStatus(webinarId, ['draft'], 'published', {}, tx),
    );
    if (!published) throw conflict('not_publishable', 'Only a draft webinar can be published');
    await this.record(principal.userId, webinar, 'webinar.published', { webinarId });
    this.events.toAudience(webinarId, 'webinar.state', { webinarId, status: 'published' });
    return { webinarId, status: 'published' };
  }

  async cancel(webinarId: string, principal: Principal): Promise<WebinarStatusResponse> {
    const webinar = await this.access.load(webinarId);
    if (webinar.status === 'canceled') return { webinarId, status: 'canceled' };
    const canceled = await this.access.scoped(webinar.orgId, (tx) =>
      this.repo.transitionStatus(webinarId, ['draft', 'published'], 'canceled', {}, tx),
    );
    // A live webinar is ended, not canceled (WEBINAR_STATUS_TRANSITIONS).
    if (!canceled) throw conflict('not_cancelable', 'Only a draft or published webinar can be canceled');

    await this.record(principal.userId, webinar, 'webinar.canceled', { webinarId });
    this.events.toAudience(webinarId, 'webinar.state', { webinarId, status: 'canceled' });
    const registrations = await this.access.scoped(webinar.orgId, (tx) => this.repo.listActiveRegistrations(webinarId, tx));
    for (const registration of registrations) {
      try {
        await this.scheduler.cancelReminders(registration.id);
      } catch (error) {
        // A reminder that still fires re-reads the occurrence and skips a canceled one (CW-R-37).
        this.logger.warn({ webinarId, operation: 'cancelReminders', error: errorName(error) }, 'Webinar reminders not removed');
      }
      await this.mail.canceled(registration.userId, registration.id, webinar);
    }
    return { webinarId, status: 'canceled' };
  }

  // ── Attendance (WBN-33) ───────────────────────────────────────────────────

  async attendance(webinarId: string, principal: Principal): Promise<WebinarAttendanceResponse> {
    assertOperationsSession(principal);
    const webinar = await this.access.load(webinarId);
    const resource = webinarStaffResourceOf(webinar);
    const allowed =
      (await this.access.allows(principal, ACTIONS['event.manage'], resource)) ||
      (await this.access.allows(principal, ACTIONS['event.moderate'], resource));
    if (!allowed) return this.access.deny(principal, ACTIONS['event.manage'], webinar);

    const { registrations, presence } = await this.access.scoped(webinar.orgId, async (tx) => ({
      registrations: await this.repo.listActiveRegistrations(webinarId, tx),
      presence: await this.repo.attendeePresence(webinarId, tx),
    }));
    const byUser = new Map<string, PresenceInterval>();
    for (const row of presence) {
      const seen = byUser.get(row.userId) ?? { joinedAt: null, leftAt: null };
      if (row.firstJoinedAt && (!seen.joinedAt || row.firstJoinedAt < seen.joinedAt)) seen.joinedAt = row.firstJoinedAt;
      if (row.lastLeftAt && (!seen.leftAt || row.lastLeftAt > seen.leftAt)) seen.leftAt = row.lastLeftAt;
      byUser.set(row.userId, seen);
    }

    const now = new Date();
    const until = webinar.endedAt ?? (now < webinar.endsAt ? now : webinar.endsAt);
    const length = ((webinar.endedAt ?? webinar.endsAt).getTime() - (webinar.startedAt ?? webinar.startsAt).getTime()) / MINUTE_MS;
    const intervals: PresenceInterval[] = [];
    const registrants = registrations.map((registration) => {
      const seen = byUser.get(registration.userId) ?? { joinedAt: null, leftAt: null };
      if (seen.joinedAt) intervals.push(seen);
      const minutes = attendedMinutes(seen, until);
      return {
        registrationId: registration.id,
        joinedAt: seen.joinedAt?.toISOString() ?? null,
        leftAt: seen.leftAt?.toISOString() ?? null,
        attendedMinutes: minutes,
        completionPercent: completionPercent(minutes, length),
      };
    });
    // WBN-33 criterion 5: viewing per-registrant attendance is audited.
    await this.record(principal.userId, webinar, 'webinar.attendance.viewed', { webinarId });
    return {
      webinarId,
      registeredCount: registrations.length,
      joinedCount: intervals.length,
      peakConcurrent: peakConcurrent(intervals, until),
      registrants,
    };
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** The audience names organisations and units that exist (WBN-31 criterion 5). */
  private async assertAudience(policy: WebinarAudiencePolicy): Promise<void> {
    if (policy.type === 'organization') {
      const active = await this.repo.activeOrganizations(policy.orgIds);
      if (active.size !== policy.orgIds.length) throw invalidField('audiencePolicy', 'Every organisation must be an active client');
    }
    if (policy.type === 'org_unit') {
      const active = await this.repo.activeOrganizations([policy.orgId]);
      const units = await this.repo.unitsOfOrganization(policy.orgId, policy.orgUnitIds);
      if (active.size !== 1 || units.size !== policy.orgUnitIds.length) {
        throw invalidField('audiencePolicy', 'Every unit must belong to the organisation');
      }
    }
  }

  /** Host rows for the presenters and the moderator: existing, active people, shown by first name (D-CW-15). */
  private async hostsFor(presenterUserIds: readonly string[], moderatorUserId: string | null): Promise<NewWebinarHost[]> {
    if (moderatorUserId && presenterUserIds.includes(moderatorUserId)) {
      throw invalidField('moderatorUserId', 'The moderator cannot also be a presenter');
    }
    const ids = moderatorUserId ? [...presenterUserIds, moderatorUserId] : [...presenterUserIds];
    const names = await this.repo.displayNames(ids);
    const host = (userId: string, role: WebinarHostRole, field: string): NewWebinarHost => {
      const name = names.get(userId);
      if (name === undefined) throw invalidField(field, 'Every host must be an active user');
      return { userId, role, displayName: firstNameOf(name) ?? name };
    };
    return [
      ...presenterUserIds.map((userId) => host(userId, 'presenter', 'presenterUserIds')),
      ...(moderatorUserId ? [host(moderatorUserId, 'moderator', 'moderatorUserId')] : []),
    ];
  }

  private async invalidate(userIds: readonly string[]): Promise<void> {
    for (const userId of new Set(userIds)) await this.principals.invalidateUser(userId);
  }

  /** A new start time moves every registrant's reminders. */
  private async rescheduleReminders(webinar: WebinarRecord): Promise<void> {
    const registrations = await this.access.scoped(webinar.orgId, (tx) => this.repo.listActiveRegistrations(webinar.id, tx));
    for (const registration of registrations) {
      try {
        await this.scheduler.cancelReminders(registration.id);
        await this.scheduler.scheduleReminders(registration, webinar.startsAt);
      } catch (error) {
        this.logger.error({ webinarId: webinar.id, operation: 'rescheduleReminders', error: errorName(error) }, 'Reminders not moved');
      }
    }
  }

  private record(
    actorUserId: string,
    webinar: Pick<WebinarRecord, 'id' | 'orgId'>,
    action: AuditEventInput['action'],
    details: Record<string, unknown>,
  ): Promise<void> {
    return this.audit.record({
      action,
      actorUserId,
      actorKind: 'USER',
      orgId: webinar.orgId,
      recordType: 'webinar',
      recordId: webinar.id,
      result: 'ALLOWED',
      details,
    });
  }
}
