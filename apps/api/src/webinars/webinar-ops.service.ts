/**
 * WebinarOpsService: the occurrence form and the operations views
 * (T-CW-2.1, WBN-30 to WBN-33, D-CW-14, D-CW-17, D-CW-34, D-CW-36).
 *
 * - Create and edit (`POST`, `PATCH /ops/webinars`, `event.manage`): title
 *   and description per locale, schedule, audience policy, capacity (at most
 *   `WEBINAR_SINGLE_MEETING_CAPACITY` until M3: 400 `capacity_above_limit`),
 *   presenters and the moderator. No recording field: every webinar is
 *   recorded. A new occurrence is `draft`; editing is allowed while `draft`
 *   or `published` (409 `not_editable` after). The occurrence takes the
 *   organisation its audience names (CW-R-23); an audience edit that changes
 *   it is a draft-only edit (409 `not_editable`) and needs `event.manage` on
 *   the new organisation too. An edit of a published occurrence re-runs the
 *   publish checks. Each presenter gets a CASE assignment on the occurrence,
 *   so the `expert` template's `event.present` reaches it; a removed
 *   presenter's assignment ends. A capacity below the active registrations,
 *   counted under the row lock, is refused.
 * - Publish (WBN-31): at least one presenter and the moderator, whom the
 *   engine lets present (`event.present`) and moderate (`event.moderate`)
 *   this occurrence, a start in the future and an audience that names active
 *   organisations; 400 `validation` naming the field otherwise.
 * - Cancel (WBN-32): from `draft` or `published`; the presenters' CASE
 *   assignments end, every registrant's reminders are removed and the
 *   cancellation email goes out.
 * - List (`GET /ops/webinars`, an addition to the canonical route list for
 *   the admin index): the occurrences the caller may manage or moderate,
 *   every status, paged on `(startsAt, id)`; with `mine=true` the ones the
 *   caller hosts, from any context (the presenter's list). Detail
 *   (`GET /ops/webinars/:id`): `event.manage` or `event.moderate`.
 * - The form's lookups (`event.manage`): `GET /ops/webinars/host-candidates`
 *   (experts and staff whose grants list `event.present` or `event.moderate`)
 *   and `GET /ops/orgs` (the organisations the caller may manage).
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
  type AssignmentInput,
  type OpsOrganizationsQuery,
  type OpsOrganizationsResponse,
  type WebinarHostCandidatesQuery,
  type WebinarHostCandidatesResponse,
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
import { authorize } from '../authz/authorize.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ContextLoader } from '../authz/context-loader.js';
import { assertOperationsSession } from '../authz/resolvers.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarJobSchedulerService } from '../jobs/webinar-job-scheduler.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { PrincipalLoader } from '../principal/principal-loader.js';
import { assemblePrincipal } from '../principal/assemble-principal.js';
import { assertCapacityWithinLimit } from '../video/video-provider.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { WebinarAccess, conflict, invalidField, notEditable, notFound } from './webinar-access.js';
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
/** Most rows of the form's lookups (host candidates, organisations). */
const LOOKUP_LIMIT = 50;

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
    private readonly contextLoader: ContextLoader,
    private readonly audit: AuditWriter,
    private readonly scheduler: WebinarJobSchedulerService,
    private readonly mail: WebinarMailer,
    private readonly events: WebinarRoomEvents,
  ) {}

  // ── List, detail and the form's lookups ───────────────────────────────────

  async list(principal: Principal, query: WebinarOpsListQuery): Promise<WebinarOpsListResponse> {
    const after = query.cursor ? decodePageCursor(query.cursor) : undefined;
    if (after === null) throw invalidField('cursor', 'The cursor is not valid');
    const limit = query.limit ?? WEBINAR_LIST_DEFAULT_LIMIT;
    const filter = {
      statuses: query.status ? [query.status] : WEBINAR_STATUSES,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
      after,
      limit: limit + 1,
    };
    const keyOf = (webinar: WebinarRecord) => ({ at: webinar.startsAt, id: webinar.id });

    if (query.mine) {
      // The caller's own occurrences, from the expert context too: a host row the engine still backs.
      const rows = await this.repo.list({ ...filter, hostUserId: principal.userId, orgIds: query.orgId ? [query.orgId] : null });
      const page = paginate(rows, limit, keyOf);
      const hosted: WebinarRecord[] = [];
      for (const webinar of page.items) if (await this.access.host(webinar, principal)) hosted.push(webinar);
      const hosts = await this.repo.listHostsFor(hosted.map((webinar) => webinar.id));
      return { items: hosted.map((webinar) => toWebinar(webinar, hosts.get(webinar.id) ?? [])), nextCursor: page.nextCursor };
    }

    assertOperationsSession(principal);
    const scope = await this.access.organisationsFor(principal, [ACTIONS['event.manage'], ACTIONS['event.moderate']]);
    if (scope !== null && scope.length === 0) return this.access.deny(principal, ACTIONS['event.manage'], null);
    let orgIds: string[] | null = scope;
    if (query.orgId) orgIds = scope === null || scope.includes(query.orgId) ? [query.orgId] : [];

    const rows = await this.repo.list({ ...filter, orgIds });
    const page = paginate(rows, limit, keyOf);
    const hosts = await this.repo.listHostsFor(page.items.map((webinar) => webinar.id));
    return { items: page.items.map((webinar) => toWebinar(webinar, hosts.get(webinar.id) ?? [])), nextCursor: page.nextCursor };
  }

  /** `GET /ops/webinars/:id`: `event.manage` or `event.moderate` on the occurrence, in the operations context. */
  async get(webinarId: string, principal: Principal): Promise<Webinar> {
    assertOperationsSession(principal);
    const webinar = await this.access.load(webinarId);
    await this.assertManagesOrModerates(webinar, principal);
    const hosts = await this.access.scoped(webinar.orgId, (tx) => this.repo.listHosts(webinarId, tx));
    return toWebinar(webinar, hosts);
  }

  /** `GET /ops/webinars/host-candidates`: experts and staff whose grants list the role's action (`event.manage`). */
  async hostCandidates(principal: Principal, query: WebinarHostCandidatesQuery): Promise<WebinarHostCandidatesResponse> {
    await this.assertManagesSomewhere(principal);
    const action = query.role === 'presenter' ? ACTIONS['event.present'] : ACTIONS['event.moderate'];
    const items = await this.repo.hostCandidates(action, query.q || undefined, new Date(), LOOKUP_LIMIT);
    return { items };
  }

  /** `GET /ops/orgs`: the active organisations whose occurrences the caller may manage (the audience picker). */
  async organisations(principal: Principal, query: OpsOrganizationsQuery): Promise<OpsOrganizationsResponse> {
    const scope = await this.assertManagesSomewhere(principal);
    return { items: await this.repo.organisations(scope, query.q || undefined, LOOKUP_LIMIT) };
  }

  /** The organisations the caller may manage occurrences of (null: every one); 404 when none, in the operations context. */
  private async assertManagesSomewhere(principal: Principal): Promise<string[] | null> {
    assertOperationsSession(principal);
    const scope = await this.access.organisationsFor(principal, [ACTIONS['event.manage']]);
    if (scope !== null && scope.length === 0) return this.access.deny(principal, ACTIONS['event.manage'], null);
    return scope;
  }

  private async assertManagesOrModerates(webinar: WebinarRecord, principal: Principal): Promise<void> {
    const resource = webinarStaffResourceOf(webinar);
    const allowed =
      (await this.access.allows(principal, ACTIONS['event.manage'], resource)) ||
      (await this.access.allows(principal, ACTIONS['event.moderate'], resource));
    if (!allowed) await this.access.deny(principal, ACTIONS['event.manage'], webinar);
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

  /**
   * WBN-30: while `draft` or `published` (409 `not_editable` otherwise). An
   * audience change that moves the occurrence to another organisation is a
   * draft-only edit: once published, registrations were taken under the old
   * audience. A published occurrence must still pass the publish checks
   * afterwards (hosts, their rights, a start in the future, the audience), and
   * its capacity is compared with the registrations under the row lock.
   */
  async update(webinarId: string, body: WebinarUpdateRequest, principal: Principal): Promise<Webinar> {
    const current = await this.access.load(webinarId);
    if (current.status !== 'draft' && current.status !== 'published') {
      throw notEditable('Only a draft or published webinar can be edited');
    }
    if (body.capacity !== undefined) assertCapacityWithinLimit('webinar', body.capacity);

    const patch: WebinarPatch = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.timeZone !== undefined) patch.timeZone = body.timeZone;
    if (body.startsAt !== undefined) patch.startsAt = new Date(body.startsAt);
    if (body.endsAt !== undefined) patch.endsAt = new Date(body.endsAt);
    if (body.capacity !== undefined) patch.capacity = body.capacity;
    if ((patch.endsAt ?? current.endsAt).getTime() <= (patch.startsAt ?? current.startsAt).getTime()) {
      throw invalidField('endsAt', 'endsAt must be after startsAt');
    }
    if (body.audiencePolicy !== undefined) {
      await this.assertAudience(body.audiencePolicy);
      patch.audiencePolicy = body.audiencePolicy;
      const orgId = occurrenceOrgId(body.audiencePolicy);
      if (orgId !== current.orgId) {
        if (current.status !== 'draft') {
          throw notEditable('The organisation of an occurrence can change only while it is a draft');
        }
        // The guard checked the occurrence where it is; moving it needs the right where it goes.
        await this.authz.require(
          principal,
          ACTIONS['event.manage'],
          orgId ? { type: WEBINAR_RESOURCE_TYPE, orgId } : { type: WEBINAR_RESOURCE_TYPE },
        );
        patch.orgId = orgId;
      }
    }

    const before = await this.access.scoped(current.orgId, (tx) => this.repo.listHosts(webinarId, tx));
    let hosts: NewWebinarHost[] | null = null;
    if (body.presenterUserIds !== undefined || body.moderatorUserId !== undefined) {
      const presenters = body.presenterUserIds ?? before.filter((h) => h.role === 'presenter').map((h) => h.userId);
      const moderator =
        body.moderatorUserId !== undefined ? body.moderatorUserId : (before.find((h) => h.role === 'moderator')?.userId ?? null);
      hosts = await this.hostsFor(presenters, moderator);
    }
    if (current.status === 'published') {
      // WBN-31: what was checked at publication must still hold after the edit.
      await this.assertPublishable(
        { ...current, ...patch },
        hosts ?? before.map((h) => ({ userId: h.userId, role: h.role, displayName: h.displayName })),
      );
    }

    const orgChanged = patch.orgId !== undefined;
    // A move between organisations runs in the system context: the row leaves the old tenant's scope.
    const { webinar, saved, changed } = await this.access.transaction(orgChanged ? null : current.orgId, async (tx) => {
      const locked = await this.repo.lockById(webinarId, tx);
      if (!locked) throw notFound();
      if (locked.status !== 'draft' && locked.status !== 'published') {
        throw notEditable('Only a draft or published webinar can be edited');
      }
      if (orgChanged && locked.status !== 'draft') {
        throw notEditable('The organisation of an occurrence can change only while it is a draft');
      }
      // Registrations count under the lock, as at registration (CW-R-31).
      if (patch.capacity !== undefined && patch.capacity < (await this.repo.countActiveRegistrations(webinarId, tx))) {
        throw conflict('capacity_below_registrations', 'The capacity cannot be below the number of registrations');
      }
      // A host-only edit changes no column of the occurrence itself.
      const updated = Object.keys(patch).length > 0 ? ((await this.repo.update(webinarId, patch, tx)) ?? locked) : locked;
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

    const hosts = await this.access.scoped(webinar.orgId, (tx) => this.repo.listHosts(webinarId, tx));
    await this.assertPublishable(webinar, hosts);

    const published = await this.access.scoped(webinar.orgId, (tx) => this.repo.transitionStatus(webinarId, 'published', {}, tx));
    if (!published) throw conflict('not_publishable', 'Only a draft webinar can be published');
    await this.record(principal.userId, webinar, 'webinar.published', { webinarId });
    this.events.toAudience(webinarId, 'webinar.state', { webinarId, status: 'published' });
    return { webinarId, status: 'published' };
  }

  async cancel(webinarId: string, principal: Principal): Promise<WebinarStatusResponse> {
    const webinar = await this.access.load(webinarId);
    if (webinar.status === 'canceled') return { webinarId, status: 'canceled' };
    // A live webinar is ended, not canceled (WEBINAR_STATUS_TRANSITIONS).
    const canceled = await this.access.scoped(webinar.orgId, (tx) => this.repo.transitionStatus(webinarId, 'canceled', {}, tx));
    if (!canceled) throw conflict('not_cancelable', 'Only a draft or published webinar can be canceled');

    // The occurrence will not take place: the presenters' CASE assignments on it end.
    const unassigned = await this.access.scoped(webinar.orgId, (tx) => this.repo.endPresenterAssignments(webinarId, tx));
    await this.invalidate(unassigned);
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

  /**
   * The publish checks (WBN-31 criterion 5), also re-run on an edit of a
   * published occurrence: at least one presenter and the moderator, each of
   * whom the engine lets take the role on the occurrence (`event.present`,
   * `event.moderate`), a start in the future and an audience naming active
   * organisations. A failure is 400 `validation` naming the field.
   */
  private async assertPublishable(
    webinar: Pick<WebinarRecord, 'id' | 'orgId' | 'startsAt' | 'audiencePolicy'>,
    hosts: readonly { userId: string; role: 'presenter' | 'moderator' }[],
  ): Promise<void> {
    const presenters = hosts.filter((host) => host.role === 'presenter');
    const moderator = hosts.find((host) => host.role === 'moderator');
    if (presenters.length === 0) throw invalidField('presenterUserIds', 'Publishing needs at least one presenter');
    if (!moderator) throw invalidField('moderatorUserId', 'Publishing needs a moderator');
    if (webinar.startsAt.getTime() <= Date.now()) throw invalidField('startsAt', 'The webinar must start in the future');
    await this.assertAudience(webinar.audiencePolicy);
    if (!(await this.mayHost(moderator.userId, 'moderator', webinar))) {
      throw invalidField('moderatorUserId', 'The moderator cannot moderate this webinar');
    }
    for (const presenter of presenters) {
      if (!(await this.mayHost(presenter.userId, 'presenter', webinar))) {
        throw invalidField('presenterUserIds', 'A presenter cannot present this webinar');
      }
    }
  }

  // ── Attendance (WBN-33) ───────────────────────────────────────────────────

  async attendance(webinarId: string, principal: Principal): Promise<WebinarAttendanceResponse> {
    assertOperationsSession(principal);
    const webinar = await this.access.load(webinarId);
    await this.assertManagesOrModerates(webinar, principal);

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

  /**
   * Whether the engine lets `userId` take the host `role` on the occurrence
   * (WBN-31, T-CW-2.1 review): `event.moderate` on the staff resource for the
   * moderator, in the operations context; `event.present` for a presenter, in
   * the expert context, with the CASE assignment the occurrence form gives
   * presenters (added here as planned, so a presenter named in the same
   * request is judged as they will be). User state, context validity, scope
   * and conditions are the engine's.
   */
  private async mayHost(userId: string, role: 'presenter' | 'moderator', webinar: Pick<WebinarRecord, 'id' | 'orgId'>): Promise<boolean> {
    const loaded = await this.principals.load(userId);
    if (!loaded) return false;
    const principal = assemblePrincipal(loaded, role === 'presenter' ? { kind: 'expert' } : { kind: 'operations' });
    const action = role === 'presenter' ? ACTIONS['event.present'] : ACTIONS['event.moderate'];
    const resource = webinarStaffResourceOf(webinar);
    const ctx = await this.contextLoader.build(principal, resource, { action, loadedPrincipal: loaded });
    const planned: AssignmentInput[] =
      role === 'presenter'
        ? [{ id: `planned_${webinar.id}`, userId, kind: 'CASE', targetId: webinar.id, startAt: ctx.now, endAt: null }]
        : [];
    return authorize(principal, action, resource, { ...ctx, assignments: [...ctx.assignments, ...planned] }).allowed;
  }

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
