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
  SAMPLE_ORG_B,
  SAMPLE_ORG_B_UNITS,
  SAMPLE_TEAMS,
  SAMPLE_PEOPLE,
  SAMPLE_EDITORIAL_STAFF,
  SAMPLE_CHANNELS,
  SAMPLE_POSTS,
  SAMPLE_POLLS,
  SAMPLE_EXPERTS,
  SAMPLE_CONTENT,
  SAMPLE_ORG_UNITS,
  SAMPLE_EXPERT_CREDENTIALS,
  SAMPLE_EXTERNAL_IDENTITIES,
  SAMPLE_CASE,
  SAMPLE_CATEGORIES,
  SAMPLE_CATEGORY_LABELS,
  SAMPLE_ACCEPTANCE_PEOPLE,
  SAMPLE_ACCEPTANCE_ROLES,
  SAMPLE_CONTENT_RESOURCES,
  SAMPLE_PUBLICATION_DATES,
  acceptanceScaleEmployees,
} from '@nestself/sample-data';
import { approvalHash } from '@nestself/content/schema';
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

/**
 * Templates granted explicitly on top of the legacy-role mapping, keyed by
 * person id. The sample HR admin doubles as the employer administrator, so
 * she also holds the employer owner template (mirrors
 * `SAMPLE_PRINCIPALS.hr_admin` and `grant_user_ivana_employer_owner` in
 * `@nestself/sample-data`). The backfill never derives these.
 */
export const EXTRA_SAMPLE_TEMPLATES: Readonly<Record<string, readonly string[]>> = {
  user_ivana: ['employer_owner'],
};

/** Ids of the grants created from `EXTRA_SAMPLE_TEMPLATES`. */
export const extraSampleGrantIds = (): string[] =>
  Object.entries(EXTRA_SAMPLE_TEMPLATES).flatMap(([personId, keys]) =>
    keys.map((key) => `grant_${personId}_${key}`),
  );

/** Ids of the grants created for `SAMPLE_EDITORIAL_STAFF`. */
export const editorialStaffGrantIds = (): string[] =>
  SAMPLE_EDITORIAL_STAFF.map((staff) => `grant_${staff.id}_${staff.templateKey}`);

/** Id of the COLLECTION assignment that gives a staff member one category. */
export const editorialAssignmentId = (userId: string, categoryId: string): string =>
  `assignment_${userId}_collection_${categoryId}`;

const upperRole = <T extends string>(role: string | null | undefined): T | null =>
  role ? (role.toUpperCase() as T) : null;

export interface SeedOptions {
  /**
   * Also seed the generated acceptance employees that bring organization A to
   * 30 and organization B to 12 employees (epic 23.1). Off by default: the
   * named people are enough for the demos; aggregate tests switch it on.
   */
  seedAcceptanceScale?: boolean;
}

/**
 * Id of the grant that gives an acceptance person the employee template in one
 * organization. The person's first membership keeps the plain id, later ones
 * are suffixed with the organization (the convention of the grant backfill).
 */
export const acceptanceEmployeeGrantId = (userId: string, orgId: string, index: number): string =>
  index === 0 ? `grant_${userId}_employee` : `grant_${userId}_${orgId}_employee`;

export async function seed(db: Database, options: SeedOptions = {}): Promise<Record<string, number>> {
  // ── Organisations (A and B) ──
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
  await upsertById(
    db,
    t.organizations,
    {
      id: SAMPLE_ORG_B.id,
      name: SAMPLE_ORG_B.name,
      slug: SAMPLE_ORG_B.slug,
      country: 'HU',
      timezone: 'Europe/Budapest',
      status: 'ACTIVE',
    },
    { name: SAMPLE_ORG_B.name, slug: SAMPLE_ORG_B.slug },
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
  // Organization B's units, then both trees' closure rows.
  for (const ou of SAMPLE_ORG_B_UNITS) {
    await upsertById(
      db,
      t.orgUnits,
      { id: ou.id, orgId: ou.orgId, parentId: ou.parentId, kind: ou.kind, name: ou.name },
      { name: ou.name, kind: ou.kind, parentId: ou.parentId },
    );
  }
  const closureRows = [SAMPLE_ORG_UNITS, SAMPLE_ORG_B_UNITS].flatMap((units) =>
    buildClosureRows(units.map((u) => ({ id: u.id, parentId: u.parentId }))),
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

  // ── Editorial staff (CMS epic): operations staff without a legacy role ──
  for (const staff of SAMPLE_EDITORIAL_STAFF) {
    await upsertById(
      db,
      t.users,
      {
        id: staff.id,
        email: `${staff.id}@example.com`,
        displayName: staff.displayName,
        locale: 'sr-Latn',
      },
      { displayName: staff.displayName },
    );
  }

  // ── Acceptance people (T-C1.14): organization B and the two-membership person ──
  for (const person of SAMPLE_ACCEPTANCE_PEOPLE) {
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
    for (const m of person.memberships) {
      await upsertAcceptanceMembership(db, person.id, m.orgId, m.orgUnitId);
    }
  }

  // ── Generated acceptance employees (opt-in, epic 23.1 scale) ──
  const generatedEmployees = options.seedAcceptanceScale ? acceptanceScaleEmployees() : [];
  for (const employee of generatedEmployees) {
    await upsertById(
      db,
      t.users,
      {
        id: employee.id,
        email: `${employee.id}@example.com`,
        displayName: employee.displayName,
        locale: 'sr-Latn',
      },
      { displayName: employee.displayName },
    );
    await upsertAcceptanceMembership(db, employee.id, employee.orgId, employee.orgUnitId);
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

  // ── Categories and labels (T-C1.04) ──
  for (const cat of SAMPLE_CATEGORIES) {
    await upsertById(
      db,
      t.categories,
      { id: cat.id, slug: cat.slug, sortOrder: cat.sortOrder },
      { slug: cat.slug, sortOrder: cat.sortOrder },
    );
  }
  for (const label of SAMPLE_CATEGORY_LABELS) {
    await upsertById(
      db,
      t.categoryLabels,
      {
        id: label.id,
        categoryId: label.categoryId,
        locale: label.locale,
        name: label.name,
        description: label.description,
      },
      { name: label.name, description: label.description },
    );
  }

  // ── Organization content capabilities (T-C1.04) ──
  // Every seeded organization gets the 'library' capability.
  // configuredByUserId is the client-operations staff member (holds
  // service.configure) rather than the HR admin.
  const clientOps = SAMPLE_PEOPLE.find((p) => p.platformRole === 'operations');
  const configuredByUserId = clientOps?.id ?? SAMPLE_PEOPLE[0]!.id;

  // Iterate the organization fixtures, not a hard-coded list. The seed only
  // manages organizations it inserted (SAMPLE_ORG and any future additions);
  // test-created orgs are not seeded.
  const seededOrgIds = [SAMPLE_ORG.id, SAMPLE_ORG_B.id];
  for (const orgId of seededOrgIds) {
    const capId = `org_cap_${orgId}_library`;
    await upsertById(
      db,
      t.orgContentCapabilities,
      {
        id: capId,
        orgId,
        capability: 'library',
        enabledFrom: SAMPLE_START_DATE,
        configuredByUserId,
      },
      { enabledFrom: SAMPLE_START_DATE },
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

  await seedContentResources(db);

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
  const extraGrantIds = new Set(extraSampleGrantIds());
  await db.delete(t.grants).where(
    inArray(
      t.grants.id,
      SAMPLE_PEOPLE.flatMap((p) => unmappedTemplateKeys.map((key) => `grant_${p.id}_${key}`)).filter(
        (id) => !extraGrantIds.has(id),
      ),
    ),
  );

  // ── Grants derived from the legacy roles ──
  for (const person of SAMPLE_PEOPLE) {
    const legacyRole = upperRole<string>(person.orgRole);
    const platformRole = upperRole<string>(person.platformRole);
    // Platform staff and experts have no employer membership but still get
    // grants from their staff or expert template.
    if (!person.orgId && !platformRole) continue;

    const extraTemplates = (EXTRA_SAMPLE_TEMPLATES[person.id] ?? []).map((key) => {
      const tmpl = PERMISSION_TEMPLATES.find((candidate) => candidate.key === key);
      if (!tmpl) throw new Error(`EXTRA_SAMPLE_TEMPLATES names an unknown template: ${key}`);
      return tmpl;
    });

    for (const tmpl of [...templatesForLegacyRoles(legacyRole, platformRole), ...extraTemplates]) {
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

  // ── Editorial staff grants and category assignments (T-C1.03) ──
  // Granted explicitly from the template (no legacy role). ACC-R-06
  // exception: grants derived from a legacy role carry no category
  // assignment, so user_nikola's content_author and content_publisher (from
  // the OPERATIONS role) stay fail-closed: no COLLECTION assignment, no
  // content access, until one is created explicitly. The reviewer's
  // categories condition holds its review disciplines (ACC-R-07); the
  // COLLECTION assignments target category ids (C-09, ACC-R-06).
  for (const staff of SAMPLE_EDITORIAL_STAFF) {
    const tmpl = PERMISSION_TEMPLATES.find((candidate) => candidate.key === staff.templateKey);
    if (!tmpl) throw new Error(`SAMPLE_EDITORIAL_STAFF names an unknown template: ${staff.templateKey}`);
    // A template that requires the categories condition (the reviewer) must
    // get its disciplines from the fixture; a grant without them would be
    // unusable, so fail the seed loudly.
    if (tmpl.requiredConditionTypes.includes('categories') && staff.disciplines.length === 0) {
      throw new Error(`${staff.id} holds ${tmpl.key} but the fixture names no review disciplines`);
    }
    const update = {
      actions: [...tmpl.actions],
      scopeType: tmpl.scopeType,
      ...resolveSampleScope(tmpl.scopeType, null, defaultTeamId),
      conditions:
        staff.disciplines.length > 0 ? [{ type: 'categories', allowed: [...staff.disciplines] }] : null,
    };
    await db
      .insert(t.grants)
      .values({
        id: `grant_${staff.id}_${tmpl.key}`,
        subjectUserId: staff.id,
        templateKey: tmpl.key,
        grantedByUserId: hrAdmin?.id ?? staff.id,
        grantedAt: SAMPLE_START_DATE,
        validFrom: SAMPLE_START_DATE,
        ...update,
      })
      .onConflictDoUpdate({ target: t.grants.id, set: update });

    for (const categoryId of staff.categoryIds) {
      await db
        .insert(t.assignments)
        .values({
          id: editorialAssignmentId(staff.id, categoryId),
          userId: staff.id,
          kind: 'COLLECTION',
          targetId: categoryId,
          assignedByUserId: hrAdmin?.id ?? staff.id,
          startAt: SAMPLE_START_DATE,
        })
        .onConflictDoNothing({ target: t.assignments.id });
    }
  }

  // ── Employee grants for the acceptance people (T-C1.14) ──
  // One employee grant per ACTIVE membership; the id convention matches the
  // grant backfill. Organization B has no HR admin, so its members are their
  // own granter (as in the backfill).
  const employeeTemplate = PERMISSION_TEMPLATES.find((tmpl) => tmpl.key === 'employee');
  if (!employeeTemplate) throw new Error('The employee permission template is missing');
  const employeeGrantees = [
    ...SAMPLE_ACCEPTANCE_PEOPLE.flatMap((p) =>
      p.memberships.map((m, index) => ({ userId: p.id, orgId: m.orgId, index })),
    ),
    ...generatedEmployees.map((e) => ({ userId: e.id, orgId: e.orgId, index: 0 })),
  ];
  for (const { userId, orgId, index } of employeeGrantees) {
    const update = {
      actions: [...employeeTemplate.actions],
      scopeType: employeeTemplate.scopeType,
      ...resolveSampleScope(employeeTemplate.scopeType, orgId, null),
      conditions: null,
    };
    await db
      .insert(t.grants)
      .values({
        id: acceptanceEmployeeGrantId(userId, orgId, index),
        subjectUserId: userId,
        templateKey: employeeTemplate.key,
        grantedByUserId: orgId === SAMPLE_ORG.id ? (hrAdmin?.id ?? userId) : userId,
        grantedAt: SAMPLE_START_DATE,
        validFrom: SAMPLE_START_DATE,
        ...update,
      })
      .onConflictDoUpdate({ target: t.grants.id, set: update });
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

async function upsertAcceptanceMembership(
  db: Database,
  userId: string,
  orgId: string,
  orgUnitId: string,
): Promise<void> {
  await db
    .insert(t.memberships)
    .values({
      userId,
      orgId,
      status: 'ACTIVE',
      startDate: SAMPLE_START_DATE,
      orgUnitId,
    })
    .onConflictDoUpdate({
      target: [t.memberships.userId, t.memberships.orgId, t.memberships.startDate],
      set: { status: 'ACTIVE', orgUnitId },
    });
}

/**
 * Sample articles with an approved revision per variant and the publications
 * of the availability demo (T-C1.14): `all_eligible` and `org_a` are live,
 * `future` is scheduled, `withdrawn` was live and then withdrawn. The
 * reviewer approves, the publisher publishes. Idempotent (stable ids).
 */
async function seedContentResources(db: Database): Promise<void> {
  const authorId = SAMPLE_ACCEPTANCE_ROLES.author;
  const reviewerId = SAMPLE_ACCEPTANCE_ROLES.reviewer;
  const publisherId = SAMPLE_ACCEPTANCE_ROLES.publisher;
  const liveFrom = new Date(SAMPLE_PUBLICATION_DATES.liveFrom);
  const futureFrom = new Date(SAMPLE_PUBLICATION_DATES.futureFrom);
  const withdrawnAt = new Date(SAMPLE_PUBLICATION_DATES.withdrawnAt);

  for (const resource of SAMPLE_CONTENT_RESOURCES) {
    const resourceValues = {
      type: resource.type,
      state: 'active' as const,
      primaryCategoryId: resource.primaryCategoryId,
      ownerUserId: authorId,
      reviewPolicy: resource.reviewPolicy,
      reviewDiscipline: resource.reviewDiscipline,
    };
    await upsertById(db, t.contentResources, { id: resource.id, ...resourceValues }, resourceValues);

    for (const variant of resource.variants) {
      const variantValues = {
        contentResourceId: resource.id,
        locale: variant.locale,
        slug: variant.slug,
      };
      await upsertById(db, t.contentVariants, { id: variant.id, ...variantValues }, variantValues);

      const hash = await approvalHash({
        body: variant.body,
        title: variant.title,
        summary: variant.summary,
        outcome: variant.outcome,
        durationSeconds: resource.durationSeconds,
        difficulty: resource.difficulty,
        sources: [...resource.sources],
        locale: variant.locale,
        mediaAssetIds: [],
        relatedResourceIds: [],
        cta: null,
        reviewDiscipline: resource.reviewDiscipline,
        proposedAudience: null,
      });

      const revisionId = `rev_${variant.id}_1`;
      const revisionValues = {
        contentVariantId: variant.id,
        revisionNumber: 1,
        state: 'approved' as const,
        body: variant.body,
        title: variant.title,
        summary: variant.summary,
        outcome: variant.outcome,
        durationSeconds: resource.durationSeconds,
        durationBand: resource.durationBand,
        difficulty: resource.difficulty,
        sources: [...resource.sources],
        authorUserId: authorId,
        lastEditorUserId: authorId,
        approvalHash: hash,
        submittedAt: liveFrom,
        approvedAt: liveFrom,
        approvedByUserId: reviewerId,
      };
      await upsertById(db, t.contentRevisions, { id: revisionId, ...revisionValues }, revisionValues);

      const publicationId = `pub_${variant.id}`;
      const scenario = resource.scenario;
      const publicationValues = {
        contentVariantId: variant.id,
        contentRevisionId: revisionId,
        approvalHash: hash,
        state:
          scenario === 'future'
            ? ('scheduled' as const)
            : scenario === 'withdrawn'
              ? ('withdrawn' as const)
              : ('live' as const),
        requiredCapability: 'library' as const,
        startsAt: scenario === 'future' ? futureFrom : liveFrom,
        withdrawnAt: scenario === 'withdrawn' ? withdrawnAt : null,
        withdrawnByUserId: scenario === 'withdrawn' ? publisherId : null,
        withdrawalReason: scenario === 'withdrawn' ? SAMPLE_PUBLICATION_DATES.withdrawalReason : null,
        publishedByUserId: publisherId,
      };
      await upsertById(db, t.contentPublications, { id: publicationId, ...publicationValues }, publicationValues);

      const audienceValues =
        scenario === 'org_a'
          ? { kind: 'organization' as const, orgId: SAMPLE_ORG.id, orgUnitId: null }
          : { kind: 'all_eligible' as const, orgId: null, orgUnitId: null };
      await upsertById(
        db,
        t.contentPublicationAudiences,
        { id: `aud_${publicationId}_1`, publicationId, ...audienceValues },
        { publicationId, ...audienceValues },
      );
    }
  }
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
    categories: t.categories,
    categoryLabels: t.categoryLabels,
    orgContentCapabilities: t.orgContentCapabilities,
    contentResources: t.contentResources,
    contentVariants: t.contentVariants,
    contentRevisions: t.contentRevisions,
    contentPublications: t.contentPublications,
    contentPublicationAudiences: t.contentPublicationAudiences,
  };
  const counts: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: count() }).from(table);
    counts[name] = row?.n ?? 0;
  }
  return counts;
}
