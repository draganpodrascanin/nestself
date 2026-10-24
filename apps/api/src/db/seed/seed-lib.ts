/**
 * Seed logic, extracted so that tests can import and run it.
 * The thin runner (scripts/seed.ts) opens a pool and calls seed(db).
 *
 * Idempotent: every write is an upsert keyed on a stable id from
 * `@nestself/sample-data` (sample-data rule). Runs in system context (no RLS
 * tenant setting), as the migration/owner role.
 */
import { count, eq, inArray } from 'drizzle-orm';
import {
  SAMPLE_ORG,
  SAMPLE_TEAMS,
  SAMPLE_PEOPLE,
  SAMPLE_CHANNELS,
  SAMPLE_POSTS,
  SAMPLE_POLLS,
  SAMPLE_EXPERTS,
  SAMPLE_CONTENT,
  SAMPLE_ORG_UNITS,
  SAMPLE_EXPERT_CREDENTIALS,
  SAMPLE_EXTERNAL_IDENTITIES,
  SAMPLE_CASE,
} from '@nestself/sample-data';
import { PERMISSION_TEMPLATES, type PermissionTemplateDefinition } from '@nestself/contracts';
import { RETENTION_POLICIES } from './retention-policies.js';
import { buildClosureRows } from '../../org-units/closure.js';
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { Database } from '../db.service.js';
import * as t from '../schema/index.js';

/** A fixed date for sample startDate fields. */
const SAMPLE_START_DATE = new Date('2026-01-01T00:00:00Z');
const RETENTION_EFFECTIVE_FROM = new Date('2026-10-01T00:00:00Z');

type TableWithId = PgTable & { id: AnyPgColumn };

async function upsertById<TTable extends TableWithId>(
  db: Database,
  table: TTable,
  values: TTable['$inferInsert'],
  update: Partial<TTable['$inferInsert']>,
): Promise<void> {
  await db
    .insert(table)
    .values(values)
    .onConflictDoUpdate({ target: table.id, set: update as never });
}

const upperRole = <T extends string>(role: string | null | undefined): T | null =>
  role ? (role.toUpperCase() as T) : null;

export async function seed(db: Database): Promise<Record<string, number>> {
  // ── Organisation ──
  await upsertById(
    db,
    t.organizations,
    {
      id: SAMPLE_ORG.id,
      name: SAMPLE_ORG.name,
      slug: SAMPLE_ORG.slug,
      country: 'RS',
      timezone: 'Europe/Belgrade',
      status: 'ACTIVE',
    },
    { name: SAMPLE_ORG.name, slug: SAMPLE_ORG.slug },
  );

  // ── Legacy teams (legacy_teams table) ──
  for (const team of SAMPLE_TEAMS) {
    await upsertById(
      db,
      t.legacyTeams,
      { id: team.id, name: team.name, orgId: team.orgId },
      { name: team.name },
    );
  }

  // ── Org units (parents before children; fixtures are ordered that way) ──
  for (const ou of SAMPLE_ORG_UNITS) {
    await upsertById(
      db,
      t.orgUnits,
      { id: ou.id, orgId: ou.orgId, parentId: ou.parentId, kind: ou.kind, name: ou.name },
      { name: ou.name, kind: ou.kind, parentId: ou.parentId },
    );
  }

  // ── Closure table (AUTHZ-R-09: every node is its own ancestor at depth 0) ──
  const closureRows = buildClosureRows(
    SAMPLE_ORG_UNITS.map((u) => ({ id: u.id, parentId: u.parentId })),
  );
  for (const row of closureRows) {
    await db
      .insert(t.orgUnitClosure)
      .values(row)
      .onConflictDoUpdate({
        target: [t.orgUnitClosure.ancestorId, t.orgUnitClosure.descendantId],
        set: { depth: row.depth },
      });
  }

  // ── Users and memberships ──
  // Team org units share ids with the legacy teams (by design, see fixtures).
  const defaultTeamId = SAMPLE_TEAMS[0]?.id ?? null;
  const hrAdmin = SAMPLE_PEOPLE.find((p) => p.orgRole === 'hr_admin');

  for (const person of SAMPLE_PEOPLE) {
    await upsertById(
      db,
      t.users,
      {
        id: person.id,
        email: `${person.id}@example.com`,
        displayName: person.displayName,
        locale: 'sr-Latn',
      },
      { displayName: person.displayName },
    );

    // The org role is no longer stored: it only selects the templates below.
    if (person.orgId && person.orgRole) {
      await db
        .insert(t.memberships)
        .values({
          userId: person.id,
          orgId: person.orgId,
          status: 'ACTIVE',
          startDate: SAMPLE_START_DATE,
          orgUnitId: defaultTeamId,
          teamId: defaultTeamId,
        })
        .onConflictDoUpdate({
          target: [t.memberships.userId, t.memberships.orgId, t.memberships.startDate],
          set: { status: 'ACTIVE', orgUnitId: defaultTeamId },
        });
    }
  }

  // ── External identities (fake pool subjects, D-04) ──
  for (const identity of SAMPLE_EXTERNAL_IDENTITIES) {
    await db
      .insert(t.externalIdentities)
      .values({
        id: `ext_${identity.userId}`,
        userId: identity.userId,
        provider: identity.provider,
        subject: identity.subject,
        cognitoUsername: identity.cognitoUsername,
        email: identity.email,
        emailVerified: true,
      })
      .onConflictDoUpdate({
        target: [t.externalIdentities.provider, t.externalIdentities.subject],
        set: { email: identity.email, cognitoUsername: identity.cognitoUsername },
      });
  }

  // ── Channels and posts ──
  for (const ch of SAMPLE_CHANNELS) {
    const scope = ch.scope === 'org' ? 'ORGANIZATION' : 'TEAM';
    await upsertById(
      db,
      t.channels,
      {
        id: ch.id,
        name: ch.name,
        scope,
        orgId: ch.orgId,
        teamId: 'teamId' in ch ? (ch as { teamId: string }).teamId : null,
      },
      { name: ch.name, scope },
    );
  }
  for (const post of SAMPLE_POSTS) {
    await upsertById(
      db,
      t.posts,
      { id: post.id, body: post.content, channelId: post.channelId, authorId: post.authorId },
      { body: post.content },
    );
  }

  // ── Polls ──
  for (const poll of SAMPLE_POLLS) {
    await upsertById(
      db,
      t.polls,
      { id: poll.id, question: poll.title, teamId: poll.teamId },
      { question: poll.title },
    );
    for (const opt of poll.options) {
      await upsertById(
        db,
        t.pollOptions,
        { id: opt.id, label: opt.label, pollId: poll.id },
        { label: opt.label },
      );
    }
  }

  // ── Experts and credentials ──
  const seededExpertIds = new Set<string>();
  for (const e of SAMPLE_EXPERTS) {
    const area = e.area.toUpperCase() as 'PSYCHOLOGICAL' | 'LEGAL' | 'FINANCIAL';
    const user = SAMPLE_PEOPLE.find((p) => p.initials === e.initials);
    if (!user) continue;
    await upsertById(
      db,
      t.experts,
      { id: e.id, userId: user.id, area, languages: ['sr'] },
      { area },
    );
    seededExpertIds.add(e.id);
  }
  // Only for experts that were seeded (some fixtures lack a matching person).
  for (const ec of SAMPLE_EXPERT_CREDENTIALS) {
    if (!seededExpertIds.has(ec.expertId)) continue;
    await upsertById(
      db,
      t.expertCredentials,
      {
        id: ec.id,
        expertId: ec.expertId,
        serviceCategory: ec.serviceCategory,
        status: ec.status,
        effectiveFrom: SAMPLE_START_DATE,
      },
      { status: ec.status },
    );
  }

  // ── Content ──
  for (const c of SAMPLE_CONTENT) {
    const area = c.area.toUpperCase() as 'PSYCHOLOGICAL' | 'LEGAL' | 'FINANCIAL';
    await upsertById(
      db,
      t.contentItems,
      {
        id: c.id,
        title: c.title,
        summary: c.summary,
        body: c.summary,
        kind: 'ARTICLE',
        area,
        locale: c.locale,
      },
      { title: c.title, summary: c.summary },
    );
  }

  // ── Retention policies (deterministic ids; unique keys match the ids) ──
  for (const rp of RETENTION_POLICIES) {
    const id = `rp_${rp.dataCategory}_${rp.jurisdiction}_${rp.serviceType ?? 'none'}`;
    await upsertById(
      db,
      t.retentionPolicies,
      {
        id,
        dataCategory: rp.dataCategory,
        jurisdiction: rp.jurisdiction,
        serviceType: rp.serviceType,
        minDays: rp.minDays,
        maxDays: rp.maxDays,
        legalBasis: rp.legalBasis,
        effectiveFrom: RETENTION_EFFECTIVE_FROM,
      },
      { minDays: rp.minDays, maxDays: rp.maxDays, legalBasis: rp.legalBasis },
    );
  }

  // ── Permission templates (from @nestself/contracts) ──
  for (const tmpl of PERMISSION_TEMPLATES) {
    const values = {
      key: tmpl.key,
      name: tmpl.name,
      workspace: tmpl.workspace,
      population: tmpl.population,
      actions: [...tmpl.actions],
      scopeType: tmpl.scopeType,
      defaultConditions: tmpl.defaultConditions ? [...tmpl.defaultConditions] : null,
      requiresSecondFactor: tmpl.requiresSecondFactor,
      stepUpActions: [...tmpl.stepUpActions],
      isActive: tmpl.isActive,
    };
    await db
      .insert(t.permissionTemplates)
      .values({ id: `tmpl_${tmpl.key}`, ...values })
      .onConflictDoUpdate({ target: t.permissionTemplates.key, set: values });
  }

  // Seeds before the legacy-role fix (57bfd4f) also granted every sample person
  // the templates without a legacy role (employer_owner, approver, ...). Remove
  // those derived rows from databases seeded back then; explicitly created
  // grants have other ids and stay.
  const unmappedTemplateKeys = PERMISSION_TEMPLATES.filter((tmpl) => tmpl.legacyRole == null).map(
    (tmpl) => tmpl.key,
  );
  await db.delete(t.grants).where(
    inArray(
      t.grants.id,
      SAMPLE_PEOPLE.flatMap((p) => unmappedTemplateKeys.map((key) => `grant_${p.id}_${key}`)),
    ),
  );

  // ── Grants derived from the legacy roles ──
  for (const person of SAMPLE_PEOPLE) {
    const legacyRole = upperRole<string>(person.orgRole);
    const platformRole = upperRole<string>(person.platformRole);
    // Platform staff and experts have no employer membership but still get
    // grants from their staff or expert template.
    if (!person.orgId && !platformRole) continue;

    for (const tmpl of templatesForLegacyRoles(legacyRole, platformRole)) {
      const scope = resolveSampleScope(tmpl.scopeType, person.orgId ?? null, defaultTeamId);
      const update = {
        actions: [...tmpl.actions],
        scopeType: tmpl.scopeType,
        ...scope,
        conditions: await derivedGrantConditions(db, tmpl, person.id),
      };
      await db
        .insert(t.grants)
        .values({
          id: `grant_${person.id}_${tmpl.key}`,
          subjectUserId: person.id,
          templateKey: tmpl.key,
          grantedByUserId: hrAdmin?.id ?? person.id,
          grantedAt: SAMPLE_START_DATE,
          validFrom: SAMPLE_START_DATE,
          ...update,
        })
        .onConflictDoUpdate({ target: t.grants.id, set: update });
    }

    // Operations staff: CLIENT assignment to the sample organization.
    if (platformRole === 'OPERATIONS') {
      await db
        .insert(t.assignments)
        .values({
          id: `assignment_${person.id}_client_${SAMPLE_ORG.id}`,
          userId: person.id,
          kind: 'CLIENT',
          targetId: SAMPLE_ORG.id,
          assignedByUserId: hrAdmin?.id ?? person.id,
          startAt: SAMPLE_START_DATE,
        })
        .onConflictDoNothing({ target: t.assignments.id });
    }
  }

  // ── Confidential professional domain: one case (T-2.4) ──
  // The expert reaches the case through a CASE assignment targeting its id.
  await db
    .insert(t.assignments)
    .values({
      id: `assignment_${SAMPLE_CASE.expertUserId}_case_${SAMPLE_CASE.id}`,
      userId: SAMPLE_CASE.expertUserId,
      kind: 'CASE',
      targetId: SAMPLE_CASE.id,
      assignedByUserId: hrAdmin?.id ?? SAMPLE_CASE.expertUserId,
      startAt: SAMPLE_START_DATE,
    })
    .onConflictDoNothing({ target: t.assignments.id });
  const caseRef = {
    orgId: SAMPLE_CASE.orgId,
    caseId: SAMPLE_CASE.id,
    employeeUserId: SAMPLE_CASE.employeeUserId,
  };
  await upsertById(
    db,
    t.conversations,
    { id: SAMPLE_CASE.conversation.id, ...caseRef, expertUserId: SAMPLE_CASE.expertUserId },
    { ...caseRef, expertUserId: SAMPLE_CASE.expertUserId },
  );
  for (const m of SAMPLE_CASE.conversation.messages) {
    await upsertById(
      db,
      t.conversationMessages,
      {
        id: m.id,
        conversationId: SAMPLE_CASE.conversation.id,
        authorUserId: m.authorUserId,
        body: m.body,
        createdAt: new Date(m.createdAt),
      },
      { body: m.body },
    );
  }
  await upsertById(
    db,
    t.intakeRecords,
    {
      id: SAMPLE_CASE.intake.id,
      ...caseRef,
      body: SAMPLE_CASE.intake.body,
      createdAt: new Date(SAMPLE_CASE.intake.createdAt),
    },
    { body: SAMPLE_CASE.intake.body },
  );

  return countAll(db);
}

/**
 * The permission templates a legacy org role and platform role map to.
 * Templates without a legacy role (employer_owner, approver, ...) are never
 * derived: they are granted explicitly. Every org member also receives the
 * employee template. Roles are matched case-insensitively.
 */
export function templatesForLegacyRoles(
  orgRole: string | null,
  platformRole: string | null,
): PermissionTemplateDefinition[] {
  const org = orgRole?.toUpperCase() ?? null;
  const platform = platformRole?.toUpperCase() ?? null;
  const matching = PERMISSION_TEMPLATES.filter(
    (tmpl) => tmpl.legacyRole != null && (tmpl.legacyRole === org || tmpl.legacyRole === platform),
  );
  if (org && !matching.some((tmpl) => tmpl.key === 'employee')) {
    const employee = PERMISSION_TEMPLATES.find((tmpl) => tmpl.key === 'employee');
    if (employee) matching.push(employee);
  }
  return matching;
}

/**
 * Conditions a derived grant carries: the expert template is limited to the
 * expert's approved service categories. Null when there are none.
 */
export async function derivedGrantConditions(
  db: Database,
  tmpl: PermissionTemplateDefinition,
  userId: string,
): Promise<unknown[] | null> {
  if (tmpl.scopeType !== 'assigned_cases' || tmpl.key !== 'expert') return null;
  const expert = await db.query.experts.findFirst({
    where: eq(t.experts.userId, userId),
    with: { credentials: { where: eq(t.expertCredentials.status, 'APPROVED') } },
  });
  const categories = expert?.credentials.map((c) => c.serviceCategory) ?? [];
  return categories.length > 0 ? [{ type: 'categories', allowed: categories }] : null;
}

/** Grant scope columns for a template's scope type. */
export function resolveSampleScope(scopeType: string, orgId: string | null, defaultTeamId: string | null) {
  switch (scopeType) {
    case 'org_unit':
      return { scopeOrgId: orgId, scopeOrgUnitId: defaultTeamId, includeDescendants: true };
    case 'platform':
      return { scopeOrgId: null, scopeOrgUnitId: null, includeDescendants: false };
    default:
      // own, organization, assigned_cases and anything else: organization scope.
      return { scopeOrgId: orgId, scopeOrgUnitId: null, includeDescendants: false };
  }
}

async function countAll(db: Database): Promise<Record<string, number>> {
  const tables = {
    organizations: t.organizations,
    teams: t.legacyTeams,
    orgUnits: t.orgUnits,
    orgUnitClosures: t.orgUnitClosure,
    users: t.users,
    externalIdentities: t.externalIdentities,
    memberships: t.memberships,
    channels: t.channels,
    posts: t.posts,
    polls: t.polls,
    experts: t.experts,
    expertCredentials: t.expertCredentials,
    contentItems: t.contentItems,
    retentionPolicies: t.retentionPolicies,
    permissionTemplates: t.permissionTemplates,
    grants: t.grants,
    assignments: t.assignments,
    conversations: t.conversations,
    conversationMessages: t.conversationMessages,
    intakeRecords: t.intakeRecords,
  };
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: count() }).from(table);
    counts[name] = row?.n ?? 0;
  }
  return counts;
}
