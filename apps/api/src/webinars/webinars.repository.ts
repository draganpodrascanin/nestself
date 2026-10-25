/**
 * WebinarsRepository: the webinar tables, the webinar sessions in
 * `call_sessions` and the presenters' CASE assignments (T-CW-2.1). Every
 * method returns contract spellings; the UPPER_CASE enums are mapped in
 * `webinar-mapper.ts` (CW-R-19a).
 *
 * Every method takes an optional `tx`. The services pass a
 * `DbService.withOrgScope` transaction for the reads and writes of an
 * organisation's occurrence, and the system context (no tenant setting) for
 * occurrences open to several organisations, whose rows carry no
 * organisation (CW-R-23).
 *
 * Exported for the room resolvers of T-CW-2.3: {@link findById},
 * {@link findRegistration} (active registrations only) and {@link findHost}.
 */
import { Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { WEBINAR_STATUSES, canTransitionWebinar } from '@nestself/contracts';
import type {
  RecordingStatus,
  WebinarAudiencePolicy,
  WebinarHostRole,
  WebinarLocalizedText,
  WebinarMessageKind,
  WebinarMessageStatus,
  WebinarStatus,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import {
  assignments,
  callParticipants,
  callSessions,
  grants,
  memberships,
  organizations,
  orgUnitClosure,
  orgUnits,
  users,
  webinarHosts,
  webinarMessages,
  webinarPollOptions,
  webinarPollResults,
  webinarPolls,
  webinarRegistrations,
  webinars,
} from '../db/schema/index.js';
import { fromDbFormat, fromDbSessionStatus, toDbFormat, toDbSessionStatus } from '../calls/call-mapper.js';
import type { CallSessionRecord } from '../calls/calls.repository.js';
import {
  fromDbHostRole,
  fromDbMessageKind,
  fromDbMessageStatus,
  fromDbRecordingStatus,
  fromDbWebinarStatus,
  toDbHostRole,
  toDbMessageKind,
  toDbMessageStatus,
  toDbWebinarStatus,
  PRESENTER_ASSIGNMENT_REASON,
  type MembershipFact,
  type PageKey,
} from './webinar-mapper.js';

type WebinarRow = typeof webinars.$inferSelect;
type HostRow = typeof webinarHosts.$inferSelect;
type RegistrationRow = typeof webinarRegistrations.$inferSelect;
type MessageRow = typeof webinarMessages.$inferSelect;
type SessionRow = typeof callSessions.$inferSelect;

export { PRESENTER_ASSIGNMENT_REASON } from './webinar-mapper.js';

/** A `webinars` row in contract spelling. */
export interface WebinarRecord {
  id: string;
  orgId: string | null;
  title: WebinarLocalizedText;
  description: WebinarLocalizedText | null;
  audiencePolicy: WebinarAudiencePolicy;
  capacity: number;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  status: WebinarStatus;
  recordingStatus: RecordingStatus;
  chatPolicy: 'moderated';
  createdByUserId: string;
  startedAt: Date | null;
  endedAt: Date | null;
}

export interface WebinarHostRecord {
  id: string;
  webinarId: string;
  orgId: string | null;
  userId: string;
  role: WebinarHostRole;
  displayName: string;
}

export interface WebinarRegistrationRecord {
  id: string;
  webinarId: string;
  /** The registrant's organisation; never null (migration 0013). */
  orgId: string;
  userId: string;
  registeredAt: Date;
  canceledAt: Date | null;
  handRaisedAt: Date | null;
  floorGivenAt: Date | null;
  votedPollIds: string[];
}

export interface WebinarMessageRecord {
  id: string;
  webinarId: string;
  orgId: string | null;
  sessionId: string | null;
  authorParticipantId: string | null;
  /** Null once the author link is removed, 12 months after the occurrence (D-CW-29). */
  authorUserId: string | null;
  kind: WebinarMessageKind;
  status: WebinarMessageStatus;
  text: string;
  originalText: string | null;
  showFirstName: boolean;
  authorFirstName: string | null;
  publishedAt: Date | null;
  answerText: string | null;
  createdAt: Date;
}

export interface WebinarPollRecord {
  id: string;
  webinarId: string;
  orgId: string | null;
  sessionId: string | null;
  question: string;
  openedAt: Date | null;
  closedAt: Date | null;
  options: { id: string; label: string; position: number }[];
}

export interface NewWebinar {
  orgId: string | null;
  title: WebinarLocalizedText;
  description: WebinarLocalizedText | null;
  audiencePolicy: WebinarAudiencePolicy;
  capacity: number;
  startsAt: Date;
  endsAt: Date;
  timeZone: string;
  createdByUserId: string;
}

export type WebinarPatch = Partial<
  Pick<NewWebinar, 'orgId' | 'title' | 'description' | 'audiencePolicy' | 'capacity' | 'startsAt' | 'endsAt' | 'timeZone'>
>;

export interface NewWebinarHost {
  userId: string;
  role: WebinarHostRole;
  displayName: string;
}

export interface NewWebinarMessage {
  webinarId: string;
  orgId: string | null;
  sessionId: string | null;
  authorParticipantId: string | null;
  authorUserId: string;
  kind: WebinarMessageKind;
  status: WebinarMessageStatus;
  text: string;
  showFirstName: boolean;
  authorFirstName: string | null;
  publishedAt: Date | null;
  publishedByUserId: string | null;
}

export type WebinarMessageUpdate = Partial<{
  status: WebinarMessageStatus;
  text: string;
  originalText: string | null;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  answerText: string | null;
  answeredByUserId: string | null;
}>;

/** Filters of the employee list (`GET /webinars`): who may see what is decided by the audience clause. */
export interface WebinarListFilter {
  statuses: readonly WebinarStatus[];
  from?: Date;
  to?: Date;
  /** Only occurrences of these organisations (the ops list); null for every one. */
  orgIds?: readonly string[] | null;
  /** The person's memberships: only occurrences whose audience includes them (the employee list). */
  audience?: readonly MembershipFact[];
  /** Only occurrences where this person is a host (`GET /ops/webinars?mine=true`). */
  hostUserId?: string;
  after?: PageKey;
  limit: number;
}

/** A participant of an occurrence's session with its seat in a replicated webinar (T-CW-3.2). */
export interface WebinarParticipantSeat {
  id: string;
  sessionId: string;
  userId: string;
  role: string;
  providerAttendeeId: string | null;
  /** The replica (1-based) the attendee sits in; null on the primary. */
  replicaIndex: number | null;
  /** The promotion attendee on the primary while a replica attendee holds the floor. */
  floorAttendeeId: string | null;
}

/** One attendee participant's presence in one webinar session. */
export interface AttendeePresence {
  userId: string;
  firstJoinedAt: Date | null;
  lastLeftAt: Date | null;
}

function toWebinarRecord(row: WebinarRow): WebinarRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    title: row.title,
    description: row.description ?? null,
    audiencePolicy: row.audiencePolicy,
    capacity: row.capacity,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timeZone: row.timeZone,
    status: fromDbWebinarStatus(row.status),
    recordingStatus: fromDbRecordingStatus(row.recordingStatus),
    chatPolicy: 'moderated',
    createdByUserId: row.createdByUserId,
    startedAt: row.startedAt,
    endedAt: row.endedAt,
  };
}

function toHostRecord(row: HostRow): WebinarHostRecord {
  return {
    id: row.id,
    webinarId: row.webinarId,
    orgId: row.orgId,
    userId: row.userId,
    role: fromDbHostRole(row.role),
    displayName: row.displayName,
  };
}

function toRegistrationRecord(row: RegistrationRow): WebinarRegistrationRecord {
  return {
    id: row.id,
    webinarId: row.webinarId,
    orgId: row.orgId,
    userId: row.userId,
    registeredAt: row.registeredAt,
    canceledAt: row.canceledAt,
    handRaisedAt: row.handRaisedAt,
    floorGivenAt: row.floorGivenAt,
    votedPollIds: row.votedPollIds,
  };
}

function toMessageRecord(row: MessageRow): WebinarMessageRecord {
  return {
    id: row.id,
    webinarId: row.webinarId,
    orgId: row.orgId,
    sessionId: row.sessionId,
    authorParticipantId: row.authorParticipantId,
    authorUserId: row.authorUserId,
    kind: fromDbMessageKind(row.kind),
    status: fromDbMessageStatus(row.status),
    text: row.text,
    originalText: row.originalText,
    showFirstName: row.showFirstName,
    authorFirstName: row.authorFirstName,
    publishedAt: row.publishedAt,
    answerText: row.answerText,
    createdAt: row.createdAt,
  };
}

function toSessionRecord(row: SessionRow): CallSessionRecord {
  return {
    ...row,
    format: fromDbFormat(row.format),
    status: fromDbSessionStatus(row.status),
    endReason: row.endReason ? (row.endReason.toLowerCase() as CallSessionRecord['endReason']) : null,
  };
}

/** `ids` as a `text[]` parameter for the jsonb `?|` operator. */
function textArrayParam(ids: readonly string[]): SQL {
  return sql`${`{${ids.map((id) => `"${id.replace(/["\\]/g, '\\$&')}"`).join(',')}}`}::text[]`;
}

/**
 * The SQL audience clause (CW-R-32): `all_eligible` for anyone with a
 * membership, an organisation policy naming one of the person's
 * organisations, a unit policy of one of their organisations naming one of
 * their units or an ancestor of it.
 */
function audienceClause(facts: readonly MembershipFact[]): SQL {
  if (facts.length === 0) return sql`false`;
  const policy = webinars.audiencePolicy;
  const orgIds = [...new Set(facts.map((fact) => fact.orgId))];
  const unitClauses = facts
    .filter((fact) => fact.orgUnitAncestorIds.length > 0)
    .map(
      (fact) =>
        sql`(${policy} ->> 'orgId' = ${fact.orgId} AND ${policy} -> 'orgUnitIds' ?| ${textArrayParam(fact.orgUnitAncestorIds)})`,
    );
  const clauses: SQL[] = [
    sql`${policy} ->> 'type' = 'all_eligible'`,
    sql`(${policy} ->> 'type' = 'organization' AND ${policy} -> 'orgIds' ?| ${textArrayParam(orgIds)})`,
  ];
  if (unitClauses.length > 0) {
    clauses.push(sql`(${policy} ->> 'type' = 'org_unit' AND (${sql.join(unitClauses, sql` OR `)}))`);
  }
  return sql`(${sql.join(clauses, sql` OR `)})`;
}

@Injectable()
export class WebinarsRepository {
  constructor(private readonly dbs: DbService) {}

  private exec(tx?: DbExecutor): DbExecutor {
    return tx ?? this.dbs.db;
  }

  // ── Occurrences ───────────────────────────────────────────────────────────

  async findById(id: string, tx?: DbExecutor): Promise<WebinarRecord | null> {
    const [row] = await this.exec(tx).select().from(webinars).where(eq(webinars.id, id));
    return row ? toWebinarRecord(row) : null;
  }

  /** The row, locked `FOR UPDATE` until `tx` ends: registrations and session creation run one at a time (CW-R-31). */
  async lockById(id: string, tx: DbExecutor): Promise<WebinarRecord | null> {
    const [row] = await tx.select().from(webinars).where(eq(webinars.id, id)).for('update');
    return row ? toWebinarRecord(row) : null;
  }

  async create(values: NewWebinar, tx?: DbExecutor): Promise<WebinarRecord> {
    const [row] = await this.exec(tx)
      .insert(webinars)
      .values({ ...values, status: toDbWebinarStatus('draft') })
      .returning();
    return toWebinarRecord(row!);
  }

  async update(id: string, patch: WebinarPatch, tx?: DbExecutor): Promise<WebinarRecord | null> {
    const [row] = await this.exec(tx).update(webinars).set(patch).where(eq(webinars.id, id)).returning();
    return row ? toWebinarRecord(row) : null;
  }

  /**
   * Moves the occurrence to `to` from any status the lifecycle allows
   * (`WEBINAR_STATUS_TRANSITIONS`, `canTransitionWebinar`); null when the
   * occurrence is in none of them, for example because another request moved
   * it first.
   */
  async transitionStatus(
    id: string,
    to: WebinarStatus,
    fields: Partial<Pick<WebinarRow, 'startedAt' | 'endedAt'>> = {},
    tx?: DbExecutor,
  ): Promise<WebinarRecord | null> {
    const from = WEBINAR_STATUSES.filter((status) => canTransitionWebinar(status, to));
    if (from.length === 0) return null;
    const [row] = await this.exec(tx)
      .update(webinars)
      .set({ ...fields, status: toDbWebinarStatus(to) })
      .where(and(eq(webinars.id, id), inArray(webinars.status, from.map(toDbWebinarStatus))))
      .returning();
    return row ? toWebinarRecord(row) : null;
  }

  /**
   * One page of occurrences ordered by `(startsAt, id)`, filtered by status,
   * dates, organisations and the audience clause.
   */
  async list(filter: WebinarListFilter, tx?: DbExecutor): Promise<WebinarRecord[]> {
    const conditions: SQL[] = [inArray(webinars.status, filter.statuses.map(toDbWebinarStatus))];
    if (filter.from) conditions.push(gte(webinars.startsAt, filter.from));
    if (filter.to) conditions.push(lt(webinars.startsAt, filter.to));
    if (filter.orgIds) {
      if (filter.orgIds.length === 0) return [];
      conditions.push(inArray(webinars.orgId, [...filter.orgIds]));
    }
    if (filter.audience) conditions.push(audienceClause(filter.audience));
    if (filter.hostUserId) {
      conditions.push(
        inArray(
          webinars.id,
          this.exec(tx)
            .select({ webinarId: webinarHosts.webinarId })
            .from(webinarHosts)
            .where(eq(webinarHosts.userId, filter.hostUserId)),
        ),
      );
    }
    if (filter.after) {
      const { at, id } = filter.after;
      conditions.push(or(gt(webinars.startsAt, at), and(eq(webinars.startsAt, at), gt(webinars.id, id)))!);
    }
    const rows = await this.exec(tx)
      .select()
      .from(webinars)
      .where(and(...conditions))
      .orderBy(asc(webinars.startsAt), asc(webinars.id))
      .limit(filter.limit);
    return rows.map(toWebinarRecord);
  }

  // ── Hosts ─────────────────────────────────────────────────────────────────

  async listHosts(webinarId: string, tx?: DbExecutor): Promise<WebinarHostRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(webinarHosts)
      .where(eq(webinarHosts.webinarId, webinarId))
      .orderBy(asc(webinarHosts.role), asc(webinarHosts.createdAt), asc(webinarHosts.id));
    return rows.map(toHostRecord);
  }

  /** The hosts of several occurrences, by occurrence. */
  async listHostsFor(webinarIds: readonly string[], tx?: DbExecutor): Promise<Map<string, WebinarHostRecord[]>> {
    const result = new Map<string, WebinarHostRecord[]>();
    if (webinarIds.length === 0) return result;
    const rows = await this.exec(tx)
      .select()
      .from(webinarHosts)
      .where(inArray(webinarHosts.webinarId, [...webinarIds]))
      .orderBy(asc(webinarHosts.createdAt), asc(webinarHosts.id));
    for (const row of rows) {
      const list = result.get(row.webinarId) ?? [];
      list.push(toHostRecord(row));
      result.set(row.webinarId, list);
    }
    return result;
  }

  /** The person's host row on the occurrence (presenter or moderator), or null. For T-CW-2.3's room resolvers. */
  async findHost(webinarId: string, userId: string, tx?: DbExecutor): Promise<WebinarHostRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(webinarHosts)
      .where(and(eq(webinarHosts.webinarId, webinarId), eq(webinarHosts.userId, userId)));
    return row ? toHostRecord(row) : null;
  }

  /** Replaces the occurrence's hosts; returns the presenters removed and added. */
  async replaceHosts(
    webinar: Pick<WebinarRecord, 'id' | 'orgId'>,
    hosts: readonly NewWebinarHost[],
    tx: DbExecutor,
  ): Promise<{ removedPresenters: string[]; addedPresenters: string[] }> {
    const before = await this.listHosts(webinar.id, tx);
    await tx.delete(webinarHosts).where(eq(webinarHosts.webinarId, webinar.id));
    if (hosts.length > 0) {
      await tx.insert(webinarHosts).values(
        hosts.map((host) => ({
          webinarId: webinar.id,
          orgId: webinar.orgId,
          userId: host.userId,
          role: toDbHostRole(host.role),
          displayName: host.displayName,
        })),
      );
    }
    const presentersBefore = new Set(before.filter((h) => h.role === 'presenter').map((h) => h.userId));
    const presentersAfter = new Set(hosts.filter((h) => h.role === 'presenter').map((h) => h.userId));
    return {
      removedPresenters: [...presentersBefore].filter((id) => !presentersAfter.has(id)),
      addedPresenters: [...presentersAfter].filter((id) => !presentersBefore.has(id)),
    };
  }

  /** Moves the hosts with their occurrence when its organisation changes. */
  async setHostsOrg(webinarId: string, orgId: string | null, tx: DbExecutor): Promise<void> {
    await tx.update(webinarHosts).set({ orgId }).where(eq(webinarHosts.webinarId, webinarId));
  }

  /**
   * The CASE assignment through which a presenter's `assigned_cases` grant
   * (the `expert` template's `event.present`) reaches the occurrence in
   * `authorize()`, as `AppointmentsRepository.assignExpert` does for a
   * consultation. Idempotent per presenter.
   */
  async assignPresenter(webinarId: string, userId: string, assignedByUserId: string, tx: DbExecutor): Promise<void> {
    const [current] = await tx
      .select({ id: assignments.id })
      .from(assignments)
      .where(
        and(
          eq(assignments.userId, userId),
          eq(assignments.kind, 'CASE'),
          eq(assignments.targetId, webinarId),
          eq(assignments.reason, PRESENTER_ASSIGNMENT_REASON),
          isNull(assignments.endAt),
        ),
      );
    if (current) return;
    await tx.insert(assignments).values({
      userId,
      kind: 'CASE',
      targetId: webinarId,
      assignedByUserId,
      startAt: new Date(),
      reason: PRESENTER_ASSIGNMENT_REASON,
    });
  }

  /** Ends a removed presenter's CASE assignment on the occurrence. */
  async unassignPresenter(webinarId: string, userId: string, tx: DbExecutor): Promise<void> {
    await tx
      .update(assignments)
      .set({ endAt: new Date() })
      .where(
        and(
          eq(assignments.userId, userId),
          eq(assignments.kind, 'CASE'),
          eq(assignments.targetId, webinarId),
          eq(assignments.reason, PRESENTER_ASSIGNMENT_REASON),
          isNull(assignments.endAt),
        ),
      );
  }

  /**
   * Ends every presenter's CASE assignment on the occurrence (cancel and end):
   * the occurrence is over, so `event.present` no longer reaches it. The user
   * ids whose assignment ended.
   */
  async endPresenterAssignments(webinarId: string, tx?: DbExecutor): Promise<string[]> {
    const rows = await this.exec(tx)
      .update(assignments)
      .set({ endAt: new Date() })
      .where(
        and(
          eq(assignments.kind, 'CASE'),
          eq(assignments.targetId, webinarId),
          eq(assignments.reason, PRESENTER_ASSIGNMENT_REASON),
          isNull(assignments.endAt),
        ),
      )
      .returning({ userId: assignments.userId });
    return rows.map((row) => row.userId);
  }

  /**
   * NestSelf experts and staff with a current grant that lists `action`
   * (`event.present` or `event.moderate`), by name: the host candidates of the
   * occurrence form. Read in the system context; at most `limit`.
   */
  async hostCandidates(action: string, q: string | undefined, now: Date, limit: number): Promise<{ userId: string; displayName: string }[]> {
    const conditions: SQL[] = [
      sql`${grants.actions} @> ARRAY[${action}]::text[]`,
      isNull(grants.revokedAt),
      sql`${grants.validFrom} <= ${now}`,
      or(isNull(grants.validUntil), gt(grants.validUntil, now))!,
      isNull(users.deactivatedAt),
      isNull(users.suspendedAt),
    ];
    if (q) conditions.push(sql`${users.displayName} ILIKE ${`%${q.replace(/[\\%_]/g, '\\$&')}%`}`);
    return this.dbs.db
      .selectDistinct({ userId: users.id, displayName: users.displayName })
      .from(grants)
      .innerJoin(users, eq(users.id, grants.subjectUserId))
      .where(and(...conditions))
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(limit);
  }

  /** Active organisations by name, all of them or those in `orgIds`; at most `limit`. */
  async organisations(orgIds: readonly string[] | null, q: string | undefined, limit: number): Promise<{ id: string; name: string }[]> {
    if (orgIds && orgIds.length === 0) return [];
    const conditions: SQL[] = [eq(organizations.status, 'ACTIVE')];
    if (orgIds) conditions.push(inArray(organizations.id, [...orgIds]));
    if (q) conditions.push(sql`${organizations.name} ILIKE ${`%${q.replace(/[\\%_]/g, '\\$&')}%`}`);
    return this.dbs.db
      .select({ id: organizations.id, name: organizations.name })
      .from(organizations)
      .where(and(...conditions))
      .orderBy(asc(organizations.name), asc(organizations.id))
      .limit(limit);
  }

  // ── People ────────────────────────────────────────────────────────────────

  /** Display names of active users, by id. */
  async displayNames(userIds: readonly string[], tx?: DbExecutor): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ id: users.id, displayName: users.displayName, deactivatedAt: users.deactivatedAt })
      .from(users)
      .where(inArray(users.id, [...new Set(userIds)]));
    return new Map(rows.filter((row) => !row.deactivatedAt).map((row) => [row.id, row.displayName]));
  }

  /** The ids among `orgIds` that name active organisations. */
  async activeOrganizations(orgIds: readonly string[], tx?: DbExecutor): Promise<Set<string>> {
    if (orgIds.length === 0) return new Set();
    const rows = await this.exec(tx)
      .select({ id: organizations.id })
      .from(organizations)
      .where(and(inArray(organizations.id, [...orgIds]), eq(organizations.status, 'ACTIVE')));
    return new Set(rows.map((row) => row.id));
  }

  /** The ids among `unitIds` that are units of `orgId`. */
  async unitsOfOrganization(orgId: string, unitIds: readonly string[], tx?: DbExecutor): Promise<Set<string>> {
    if (unitIds.length === 0) return new Set();
    const rows = await this.exec(tx)
      .select({ id: orgUnits.id })
      .from(orgUnits)
      .where(and(eq(orgUnits.orgId, orgId), inArray(orgUnits.id, [...unitIds])));
    return new Set(rows.map((row) => row.id));
  }

  /**
   * The person's active, date-current memberships in active organisations,
   * each with its unit's ancestor-or-self ids (D-CW-17). Read in the system
   * context: eligibility spans every organisation the person belongs to.
   */
  async membershipFacts(userId: string, now: Date): Promise<MembershipFact[]> {
    const rows = await this.dbs.db
      .select({ orgId: memberships.orgId, orgUnitId: memberships.orgUnitId })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.orgId))
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.status, 'ACTIVE'),
          sql`${memberships.startDate} <= ${now}`,
          or(isNull(memberships.endDate), gt(memberships.endDate, now)),
          eq(organizations.status, 'ACTIVE'),
        ),
      );
    const unitIds = rows.map((row) => row.orgUnitId).filter((id): id is string => id !== null);
    const ancestors = new Map<string, string[]>();
    if (unitIds.length > 0) {
      const closure = await this.dbs.db
        .select({ ancestorId: orgUnitClosure.ancestorId, descendantId: orgUnitClosure.descendantId })
        .from(orgUnitClosure)
        .where(inArray(orgUnitClosure.descendantId, unitIds));
      for (const { ancestorId, descendantId } of closure) {
        ancestors.set(descendantId, [...(ancestors.get(descendantId) ?? []), ancestorId]);
      }
    }
    return rows.map((row) => ({
      orgId: row.orgId,
      orgUnitAncestorIds: row.orgUnitId ? (ancestors.get(row.orgUnitId) ?? [row.orgUnitId]) : [],
    }));
  }

  // ── Registrations ─────────────────────────────────────────────────────────

  /** The person's active registration (not canceled), or null. For T-CW-2.3's room resolvers. */
  async findRegistration(webinarId: string, userId: string, tx?: DbExecutor): Promise<WebinarRegistrationRecord | null> {
    const row = await this.findRegistrationRow(webinarId, userId, tx);
    return row && !row.canceledAt ? row : null;
  }

  /** The person's registration row, canceled or not. */
  async findRegistrationRow(webinarId: string, userId: string, tx?: DbExecutor): Promise<WebinarRegistrationRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(webinarRegistrations)
      .where(and(eq(webinarRegistrations.webinarId, webinarId), eq(webinarRegistrations.userId, userId)));
    return row ? toRegistrationRecord(row) : null;
  }

  async findRegistrationById(id: string, tx?: DbExecutor): Promise<WebinarRegistrationRecord | null> {
    const [row] = await this.exec(tx).select().from(webinarRegistrations).where(eq(webinarRegistrations.id, id));
    return row ? toRegistrationRecord(row) : null;
  }

  async countActiveRegistrations(webinarId: string, tx?: DbExecutor): Promise<number> {
    const [row] = await this.exec(tx)
      .select({ n: count() })
      .from(webinarRegistrations)
      .where(and(eq(webinarRegistrations.webinarId, webinarId), isNull(webinarRegistrations.canceledAt)));
    return row?.n ?? 0;
  }

  /** Active registrations per occurrence. */
  async countActiveRegistrationsFor(webinarIds: readonly string[], tx?: DbExecutor): Promise<Map<string, number>> {
    if (webinarIds.length === 0) return new Map();
    const rows = await this.exec(tx)
      .select({ webinarId: webinarRegistrations.webinarId, n: count() })
      .from(webinarRegistrations)
      .where(and(inArray(webinarRegistrations.webinarId, [...webinarIds]), isNull(webinarRegistrations.canceledAt)))
      .groupBy(webinarRegistrations.webinarId);
    return new Map(rows.map((row) => [row.webinarId, row.n]));
  }

  /** The occurrences among `webinarIds` the person holds an active registration for. */
  async registeredWebinarIds(webinarIds: readonly string[], userId: string, tx?: DbExecutor): Promise<Set<string>> {
    if (webinarIds.length === 0) return new Set();
    const rows = await this.exec(tx)
      .select({ webinarId: webinarRegistrations.webinarId })
      .from(webinarRegistrations)
      .where(
        and(
          inArray(webinarRegistrations.webinarId, [...webinarIds]),
          eq(webinarRegistrations.userId, userId),
          isNull(webinarRegistrations.canceledAt),
        ),
      );
    return new Set(rows.map((row) => row.webinarId));
  }

  async listActiveRegistrations(webinarId: string, tx?: DbExecutor): Promise<WebinarRegistrationRecord[]> {
    const rows = await this.exec(tx)
      .select()
      .from(webinarRegistrations)
      .where(and(eq(webinarRegistrations.webinarId, webinarId), isNull(webinarRegistrations.canceledAt)))
      .orderBy(asc(webinarRegistrations.registeredAt), asc(webinarRegistrations.id));
    return rows.map(toRegistrationRecord);
  }

  /** A new registration, or the person's canceled one made active again (one row per person, CW-R-24a). */
  async register(
    input: { webinarId: string; orgId: string; userId: string; registeredAt: Date },
    tx: DbExecutor,
  ): Promise<WebinarRegistrationRecord> {
    const [row] = await tx
      .insert(webinarRegistrations)
      .values(input)
      .onConflictDoUpdate({
        target: [webinarRegistrations.webinarId, webinarRegistrations.userId],
        set: {
          orgId: input.orgId,
          registeredAt: input.registeredAt,
          canceledAt: null,
          handRaisedAt: null,
          floorGivenAt: null,
        },
        setWhere: isNotNull(webinarRegistrations.canceledAt),
      })
      .returning();
    if (!row) throw new Error(`registration of webinar ${input.webinarId} is already active`);
    return toRegistrationRecord(row);
  }

  /** Cancels an active registration; null when there was none. */
  async cancelRegistration(webinarId: string, userId: string, at: Date, tx?: DbExecutor): Promise<WebinarRegistrationRecord | null> {
    const [row] = await this.exec(tx)
      .update(webinarRegistrations)
      .set({ canceledAt: at, handRaisedAt: null, floorGivenAt: null })
      .where(
        and(
          eq(webinarRegistrations.webinarId, webinarId),
          eq(webinarRegistrations.userId, userId),
          isNull(webinarRegistrations.canceledAt),
        ),
      )
      .returning();
    return row ? toRegistrationRecord(row) : null;
  }

  async setHand(registrationId: string, raisedAt: Date | null, tx?: DbExecutor): Promise<WebinarRegistrationRecord | null> {
    const [row] = await this.exec(tx)
      .update(webinarRegistrations)
      .set({ handRaisedAt: raisedAt })
      .where(eq(webinarRegistrations.id, registrationId))
      .returning();
    return row ? toRegistrationRecord(row) : null;
  }

  /** Records the floor (audio only, D-CW-35); giving it lowers the hand. */
  async setFloor(registrationId: string, givenAt: Date | null, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(webinarRegistrations)
      .set(givenAt ? { floorGivenAt: givenAt, handRaisedAt: null } : { floorGivenAt: null })
      .where(eq(webinarRegistrations.id, registrationId));
  }

  /** Lowers every hand and takes back every floor of the occurrence (the webinar ended). */
  async clearHandsAndFloors(webinarId: string, tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(webinarRegistrations)
      .set({ handRaisedAt: null, floorGivenAt: null })
      .where(eq(webinarRegistrations.webinarId, webinarId));
  }

  /**
   * Marks that the registration voted in the poll: false when it already
   * had. `updated_at` is left as it was, so the row keeps no time of the
   * vote that could be matched with a result row (CW-R-24).
   */
  async markVoted(registrationId: string, pollId: string, tx: DbExecutor): Promise<boolean> {
    const rows = await tx
      .update(webinarRegistrations)
      .set({
        votedPollIds: sql`array_append(${webinarRegistrations.votedPollIds}, ${pollId}::text)`,
        updatedAt: sql`${webinarRegistrations.updatedAt}`,
      })
      .where(
        and(
          eq(webinarRegistrations.id, registrationId),
          sql`NOT (${pollId}::text = ANY(${webinarRegistrations.votedPollIds}))`,
        ),
      )
      .returning({ id: webinarRegistrations.id });
    return rows.length === 1;
  }

  /**
   * Rewrites the rows of every registration that voted in the poll, in the
   * caller's transaction (the poll's close). A vote and its registration
   * marker are written in one transaction, so until the close the two rows
   * share a transaction id (`xmin`) that a database administrator could
   * match; rewriting every voter's row at once gives them the close's
   * transaction id and breaks that link. The open-poll window is the only
   * time the link exists (CW-R-24). `updated_at` is kept.
   */
  async rewriteVoters(webinarId: string, pollId: string, tx: DbExecutor): Promise<number> {
    const rows = await tx
      .update(webinarRegistrations)
      .set({
        votedPollIds: sql`${webinarRegistrations.votedPollIds}`,
        updatedAt: sql`${webinarRegistrations.updatedAt}`,
      })
      .where(
        and(
          eq(webinarRegistrations.webinarId, webinarId),
          sql`${pollId}::text = ANY(${webinarRegistrations.votedPollIds})`,
        ),
      )
      .returning({ id: webinarRegistrations.id });
    return rows.length;
  }

  // ── Sessions (call_sessions with format WEBINAR) ──────────────────────────

  /** The occurrence's open session (PENDING, CREATING or ACTIVE), newest first, or null. */
  async findOpenSession(webinarId: string, tx?: DbExecutor): Promise<CallSessionRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(callSessions)
      .where(
        and(
          eq(callSessions.webinarId, webinarId),
          inArray(callSessions.status, (['pending', 'creating', 'active'] as const).map(toDbSessionStatus)),
        ),
      )
      .orderBy(desc(callSessions.createdAt), desc(callSessions.id))
      .limit(1);
    return row ? toSessionRecord(row) : null;
  }

  /** A new PENDING session for the occurrence with its scheduled window. The caller holds the occurrence lock. */
  async createSession(webinar: Pick<WebinarRecord, 'id' | 'orgId' | 'startsAt' | 'endsAt'>, tx: DbExecutor): Promise<CallSessionRecord> {
    const [row] = await tx
      .insert(callSessions)
      .values({
        webinarId: webinar.id,
        orgId: webinar.orgId,
        format: toDbFormat('webinar'),
        status: toDbSessionStatus('pending'),
        startsAt: webinar.startsAt,
        endsAt: webinar.endsAt,
      })
      .returning();
    return toSessionRecord(row!);
  }

  /** The participant of one of the occurrence's sessions, with its seat (T-CW-3.2), or null. */
  async findParticipantOfWebinar(
    webinarId: string,
    participantId: string,
    tx?: DbExecutor,
  ): Promise<WebinarParticipantSeat | null> {
    const [row] = await this.exec(tx)
      .select({
        id: callParticipants.id,
        sessionId: callParticipants.sessionId,
        userId: callParticipants.userId,
        role: callParticipants.role,
        providerAttendeeId: callParticipants.providerAttendeeId,
        replicaIndex: callParticipants.replicaIndex,
        floorAttendeeId: callParticipants.floorAttendeeId,
      })
      .from(callParticipants)
      .innerJoin(callSessions, eq(callSessions.id, callParticipants.sessionId))
      .where(and(eq(callParticipants.id, participantId), eq(callSessions.webinarId, webinarId)));
    return row ?? null;
  }

  // ── Media replication (D-CW-14, T-CW-3.2) ──────────────────────────────

  /** The session's replica meeting ids in replica order; empty for a single meeting. */
  async replicaMeetingIds(sessionId: string, tx?: DbExecutor): Promise<string[]> {
    const [row] = await this.exec(tx)
      .select({ ids: callSessions.replicaMeetingIds })
      .from(callSessions)
      .where(eq(callSessions.id, sessionId));
    return row?.ids ?? [];
  }

  async setReplicaMeetingIds(sessionId: string, replicaMeetingIds: readonly string[], tx?: DbExecutor): Promise<void> {
    await this.exec(tx)
      .update(callSessions)
      .set({ replicaMeetingIds: [...replicaMeetingIds] })
      .where(eq(callSessions.id, sessionId));
  }

  /** The replica (1-based) the participant is seated in; null for the primary. */
  async setParticipantReplica(participantId: string, replicaIndex: number | null, tx?: DbExecutor): Promise<void> {
    await this.exec(tx).update(callParticipants).set({ replicaIndex }).where(eq(callParticipants.id, participantId));
  }

  /** Attendee participants per replica index (absent: none), for `pickReplica`. */
  async countAttendeesByReplica(sessionId: string, tx?: DbExecutor): Promise<Record<number, number>> {
    const rows = await this.exec(tx)
      .select({ replicaIndex: callParticipants.replicaIndex, n: count() })
      .from(callParticipants)
      .where(
        and(
          eq(callParticipants.sessionId, sessionId),
          eq(callParticipants.role, 'ATTENDEE'),
          isNotNull(callParticipants.replicaIndex),
        ),
      )
      .groupBy(callParticipants.replicaIndex);
    return Object.fromEntries(rows.map((row) => [row.replicaIndex!, row.n]));
  }

  /** A replica attendee's promotion attendee on the primary while they hold the floor; null clears it. */
  async setFloorAttendee(participantId: string, floorAttendeeId: string | null, tx?: DbExecutor): Promise<void> {
    await this.exec(tx).update(callParticipants).set({ floorAttendeeId }).where(eq(callParticipants.id, participantId));
  }

  /** Attendee participants of the session. */
  async countAttendees(sessionId: string, tx?: DbExecutor): Promise<number> {
    const [row] = await this.exec(tx)
      .select({ n: count() })
      .from(callParticipants)
      .where(and(eq(callParticipants.sessionId, sessionId), eq(callParticipants.role, 'ATTENDEE')));
    return row?.n ?? 0;
  }

  /** Every attendee participant of the occurrence's sessions, with the provider's join and leave times. */
  async attendeePresence(webinarId: string, tx?: DbExecutor): Promise<AttendeePresence[]> {
    return this.exec(tx)
      .select({
        userId: callParticipants.userId,
        firstJoinedAt: callParticipants.firstJoinedAt,
        lastLeftAt: callParticipants.lastLeftAt,
      })
      .from(callParticipants)
      .innerJoin(callSessions, eq(callSessions.id, callParticipants.sessionId))
      .where(and(eq(callSessions.webinarId, webinarId), eq(callParticipants.role, 'ATTENDEE')));
  }

  // ── Messages ──────────────────────────────────────────────────────────────

  async insertMessage(values: NewWebinarMessage, tx?: DbExecutor): Promise<WebinarMessageRecord> {
    const [row] = await this.exec(tx)
      .insert(webinarMessages)
      .values({ ...values, kind: toDbMessageKind(values.kind), status: toDbMessageStatus(values.status) })
      .returning();
    return toMessageRecord(row!);
  }

  async findMessage(webinarId: string, messageId: string, tx?: DbExecutor): Promise<WebinarMessageRecord | null> {
    const [row] = await this.exec(tx)
      .select()
      .from(webinarMessages)
      .where(and(eq(webinarMessages.id, messageId), eq(webinarMessages.webinarId, webinarId)));
    return row ? toMessageRecord(row) : null;
  }

  /** Updates the message when its status is one of `from`; null when it is not (any more). */
  async updateMessage(
    messageId: string,
    from: readonly WebinarMessageStatus[],
    update: WebinarMessageUpdate,
    tx?: DbExecutor,
  ): Promise<WebinarMessageRecord | null> {
    const { status, ...rest } = update;
    const [row] = await this.exec(tx)
      .update(webinarMessages)
      .set({ ...rest, ...(status ? { status: toDbMessageStatus(status) } : {}) })
      .where(and(eq(webinarMessages.id, messageId), inArray(webinarMessages.status, from.map(toDbMessageStatus))))
      .returning();
    return row ? toMessageRecord(row) : null;
  }

  /** One page of the occurrence's messages ordered by `(createdAt, id)`; `statuses` narrows the attendee view. */
  async listMessages(
    webinarId: string,
    filter: { statuses?: readonly WebinarMessageStatus[]; after?: PageKey; limit: number },
    tx?: DbExecutor,
  ): Promise<WebinarMessageRecord[]> {
    const conditions: SQL[] = [eq(webinarMessages.webinarId, webinarId)];
    if (filter.statuses) conditions.push(inArray(webinarMessages.status, filter.statuses.map(toDbMessageStatus)));
    if (filter.after) {
      const { at, id } = filter.after;
      conditions.push(
        or(gt(webinarMessages.createdAt, at), and(eq(webinarMessages.createdAt, at), gt(webinarMessages.id, id)))!,
      );
    }
    const rows = await this.exec(tx)
      .select()
      .from(webinarMessages)
      .where(and(...conditions))
      .orderBy(asc(webinarMessages.createdAt), asc(webinarMessages.id))
      .limit(filter.limit);
    return rows.map(toMessageRecord);
  }

  // ── Polls ─────────────────────────────────────────────────────────────────

  async createPoll(
    input: {
      webinarId: string;
      orgId: string | null;
      sessionId: string | null;
      question: string;
      options: readonly string[];
      createdByUserId: string;
    },
    tx: DbExecutor,
  ): Promise<WebinarPollRecord> {
    const [poll] = await tx
      .insert(webinarPolls)
      .values({
        webinarId: input.webinarId,
        orgId: input.orgId,
        sessionId: input.sessionId,
        question: input.question,
        createdByUserId: input.createdByUserId,
      })
      .returning();
    const options = await tx
      .insert(webinarPollOptions)
      .values(input.options.map((label, position) => ({ pollId: poll!.id, orgId: input.orgId, label, position })))
      .returning();
    return {
      id: poll!.id,
      webinarId: poll!.webinarId,
      orgId: poll!.orgId,
      sessionId: poll!.sessionId,
      question: poll!.question,
      openedAt: poll!.openedAt,
      closedAt: poll!.closedAt,
      options: options
        .map((option) => ({ id: option.id, label: option.label, position: option.position }))
        .sort((a, b) => a.position - b.position),
    };
  }

  async findPoll(webinarId: string, pollId: string, tx?: DbExecutor): Promise<WebinarPollRecord | null> {
    const [poll] = await this.exec(tx)
      .select()
      .from(webinarPolls)
      .where(and(eq(webinarPolls.id, pollId), eq(webinarPolls.webinarId, webinarId)));
    if (!poll) return null;
    const options = await this.exec(tx)
      .select()
      .from(webinarPollOptions)
      .where(eq(webinarPollOptions.pollId, pollId))
      .orderBy(asc(webinarPollOptions.position));
    return {
      id: poll.id,
      webinarId: poll.webinarId,
      orgId: poll.orgId,
      sessionId: poll.sessionId,
      question: poll.question,
      openedAt: poll.openedAt,
      closedAt: poll.closedAt,
      options: options.map((option) => ({ id: option.id, label: option.label, position: option.position })),
    };
  }

  /** The occurrence's polls with their options, oldest first; `openedOnly` leaves out the ones never opened. */
  async listPolls(webinarId: string, openedOnly: boolean, tx?: DbExecutor): Promise<WebinarPollRecord[]> {
    const conditions: SQL[] = [eq(webinarPolls.webinarId, webinarId)];
    if (openedOnly) conditions.push(isNotNull(webinarPolls.openedAt));
    const polls = await this.exec(tx)
      .select()
      .from(webinarPolls)
      .where(and(...conditions))
      .orderBy(asc(webinarPolls.createdAt), asc(webinarPolls.id));
    if (polls.length === 0) return [];
    const options = await this.exec(tx)
      .select()
      .from(webinarPollOptions)
      .where(inArray(webinarPollOptions.pollId, polls.map((poll) => poll.id)))
      .orderBy(asc(webinarPollOptions.position));
    return polls.map((poll) => ({
      id: poll.id,
      webinarId: poll.webinarId,
      orgId: poll.orgId,
      sessionId: poll.sessionId,
      question: poll.question,
      openedAt: poll.openedAt,
      closedAt: poll.closedAt,
      options: options
        .filter((option) => option.pollId === poll.id)
        .map((option) => ({ id: option.id, label: option.label, position: option.position })),
    }));
  }

  /** Opens a poll that was never opened; false otherwise. */
  async openPoll(pollId: string, at: Date, tx?: DbExecutor): Promise<boolean> {
    const rows = await this.exec(tx)
      .update(webinarPolls)
      .set({ openedAt: at })
      .where(and(eq(webinarPolls.id, pollId), isNull(webinarPolls.openedAt)))
      .returning({ id: webinarPolls.id });
    return rows.length === 1;
  }

  /** Closes an open poll; false when it is not open. */
  async closePoll(pollId: string, at: Date, tx?: DbExecutor): Promise<boolean> {
    const rows = await this.exec(tx)
      .update(webinarPolls)
      .set({ closedAt: at })
      .where(and(eq(webinarPolls.id, pollId), isNotNull(webinarPolls.openedAt), isNull(webinarPolls.closedAt)))
      .returning({ id: webinarPolls.id });
    return rows.length === 1;
  }

  /** One vote: the poll and the option only (CW-R-24). */
  async insertVote(input: { pollId: string; optionId: string; orgId: string | null }, tx: DbExecutor): Promise<void> {
    await tx.insert(webinarPollResults).values(input);
  }

  /** Votes per option of the poll, every option included. */
  async pollCounts(pollId: string, tx?: DbExecutor): Promise<Map<string, number>> {
    const rows = await this.exec(tx)
      .select({ optionId: webinarPollResults.optionId, n: count() })
      .from(webinarPollResults)
      .where(eq(webinarPollResults.pollId, pollId))
      .groupBy(webinarPollResults.optionId);
    return new Map(rows.map((row) => [row.optionId, row.n]));
  }
}
