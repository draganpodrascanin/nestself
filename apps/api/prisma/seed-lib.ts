/**
 * Seed logic extracted so that tests can import and run it.
 * The thin runner (seed.ts) calls seed(prisma) after connecting.
 */
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
} from '@nestself/sample-data';
import { RETENTION_POLICIES } from './reference/retention-policies.js';
import { buildClosureRows } from '../src/org-units/closure.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';

// A fixed date for sample data startDate fields.
const SAMPLE_START_DATE = new Date('2026-01-01T00:00:00Z');

/**
 * Try to import PERMISSION_TEMPLATES from @nestself/contracts.
 * Returns null if the module or export does not exist yet
 * (the contracts agent may not have created it).
 */
async function loadPermissionTemplates(): Promise<
  ReadonlyArray<{
    key: string;
    name: string;
    workspace: string;
    population: string;
    actions: readonly string[];
    scopeType: string;
    defaultConditions: readonly unknown[];
    requiresSecondFactor: boolean;
    stepUpActions: readonly string[];
    isActive: boolean;
    legacyRole: string | null;
  }> | null
> {
  try {
    const mod = await import('@nestself/contracts');
    if ('PERMISSION_TEMPLATES' in mod && Array.isArray(mod.PERMISSION_TEMPLATES)) {
      return mod.PERMISSION_TEMPLATES as ReturnType<typeof loadPermissionTemplates> extends Promise<infer T> ? NonNullable<T> : never;
    }
    return null;
  } catch {
    return null;
  }
}

export async function seed(prisma: PrismaClient): Promise<Record<string, number>> {
  // ── Organisation ──
  await prisma.organization.upsert({
    where: { id: SAMPLE_ORG.id },
    update: { name: SAMPLE_ORG.name, slug: SAMPLE_ORG.slug },
    create: {
      id: SAMPLE_ORG.id,
      name: SAMPLE_ORG.name,
      slug: SAMPLE_ORG.slug,
      country: 'RS',
      timezone: 'Europe/Belgrade',
      status: 'ACTIVE',
    },
  });

  // ── Legacy Teams (into legacy_teams table) ──
  for (const t of SAMPLE_TEAMS) {
    await prisma.team.upsert({
      where: { id: t.id },
      update: { name: t.name },
      create: { id: t.id, name: t.name, orgId: t.orgId },
    });
  }

  // ── OrgUnits ──
  for (const ou of SAMPLE_ORG_UNITS) {
    await prisma.orgUnit.upsert({
      where: { id: ou.id },
      update: { name: ou.name, kind: ou.kind },
      create: {
        id: ou.id,
        orgId: ou.orgId,
        parentId: ou.parentId,
        kind: ou.kind,
        name: ou.name,
      },
    });
  }

  // ── OrgUnitClosure ──
  const closureRows = buildClosureRows(
    SAMPLE_ORG_UNITS.map((u: { id: string; parentId: string | null }) => ({
      id: u.id,
      parentId: u.parentId,
    })),
  );
  for (const row of closureRows) {
    await prisma.orgUnitClosure.upsert({
      where: {
        ancestorId_descendantId: {
          ancestorId: row.ancestorId,
          descendantId: row.descendantId,
        },
      },
      update: { depth: row.depth },
      create: row,
    });
  }

  // ── Users + memberships ──
  // Map from team name to org-unit id for orgUnitId assignment.
  const teamNameToOrgUnitId: Record<string, string> = {};
  for (const ou of SAMPLE_ORG_UNITS) {
    if (ou.kind === 'TEAM') {
      teamNameToOrgUnitId[ou.name] = ou.id;
    }
  }

  // Map from teamId to orgUnitId.
  const teamIdToOrgUnitId: Record<string, string> = {};
  for (const t of SAMPLE_TEAMS) {
    // The team org-unit has the same id as the legacy team (by design).
    teamIdToOrgUnitId[t.id] = t.id;
  }

  for (const p of SAMPLE_PEOPLE) {
    const platformRole = p.platformRole
      ? (p.platformRole.toUpperCase() as 'EXPERT' | 'OPERATIONS' | 'ADMIN')
      : null;

    await prisma.user.upsert({
      where: { id: p.id },
      update: { displayName: p.displayName, platformRole },
      create: {
        id: p.id,
        email: `${p.id}@example.com`,
        displayName: p.displayName,
        locale: 'sr-Latn',
        platformRole,
      },
    });

    if (p.orgId && p.orgRole) {
      const role = p.orgRole.toUpperCase() as 'EMPLOYEE' | 'MANAGER' | 'HR_ADMIN';

      // Find the first team id assigned to this user (if any).
      // For now, assign to the first team in the sample set.
      const teamId = SAMPLE_TEAMS[0]?.id ?? null;
      const orgUnitId = teamId ? teamIdToOrgUnitId[teamId] ?? null : null;

      await prisma.membership.upsert({
        where: {
          userId_orgId_startDate: {
            userId: p.id,
            orgId: p.orgId,
            startDate: SAMPLE_START_DATE,
          },
        },
        update: { role, status: 'ACTIVE', orgUnitId },
        create: {
          userId: p.id,
          orgId: p.orgId,
          role,
          status: 'ACTIVE',
          startDate: SAMPLE_START_DATE,
          orgUnitId,
          teamId,
        },
      });
    }
  }

  // ── Channels ──
  for (const ch of SAMPLE_CHANNELS) {
    const scope = ch.scope === 'org' ? 'ORGANIZATION' : 'TEAM';
    await prisma.channel.upsert({
      where: { id: ch.id },
      update: { name: ch.name, scope },
      create: {
        id: ch.id,
        name: ch.name,
        scope,
        orgId: ch.orgId,
        teamId: 'teamId' in ch ? (ch as { teamId: string }).teamId : undefined,
      },
    });
  }

  // ── Posts ──
  for (const post of SAMPLE_POSTS) {
    await prisma.post.upsert({
      where: { id: post.id },
      update: { body: post.content },
      create: {
        id: post.id,
        body: post.content,
        channelId: post.channelId,
        authorId: post.authorId,
      },
    });
  }

  // ── Polls ──
  for (const poll of SAMPLE_POLLS) {
    await prisma.poll.upsert({
      where: { id: poll.id },
      update: { question: poll.title },
      create: { id: poll.id, question: poll.title, teamId: poll.teamId },
    });

    for (const opt of poll.options) {
      await prisma.pollOption.upsert({
        where: { id: opt.id },
        update: { label: opt.label },
        create: { id: opt.id, label: opt.label, pollId: poll.id },
      });
    }
  }

  // ── Experts ──
  for (const e of SAMPLE_EXPERTS) {
    const area = e.area.toUpperCase() as 'PSYCHOLOGICAL' | 'LEGAL' | 'FINANCIAL';
    const user = SAMPLE_PEOPLE.find(
      (p: (typeof SAMPLE_PEOPLE)[number]) => p.initials === e.initials,
    );
    if (user) {
      await prisma.expert.upsert({
        where: { id: e.id },
        update: { area },
        create: { id: e.id, userId: user.id, area, languages: ['sr'] },
      });
    }
  }

  // ── Expert Credentials ──
  // Only create credentials for experts that were actually seeded
  // (some sample experts lack a matching user in SAMPLE_PEOPLE).
  for (const ec of SAMPLE_EXPERT_CREDENTIALS) {
    const expertExists = await prisma.expert.findUnique({
      where: { id: ec.expertId },
    });
    if (expertExists) {
      await prisma.expertCredential.upsert({
        where: { id: ec.id },
        update: { status: ec.status },
        create: {
          id: ec.id,
          expertId: ec.expertId,
          serviceCategory: ec.serviceCategory,
          status: ec.status,
          effectiveFrom: new Date(),
        },
      });
    }
  }

  // ── Content ──
  for (const c of SAMPLE_CONTENT) {
    const area = c.area.toUpperCase() as 'PSYCHOLOGICAL' | 'LEGAL' | 'FINANCIAL';
    await prisma.contentItem.upsert({
      where: { id: c.id },
      update: { title: c.title, summary: c.summary },
      create: {
        id: c.id,
        title: c.title,
        summary: c.summary,
        body: c.summary,
        kind: 'ARTICLE',
        area,
        locale: c.locale,
      },
    });
  }

  // ── Retention Policies ──
  // Prisma @@unique with nullable fields doesn't support null in the
  // upsert where clause, so we use findFirst + create/update instead.
  for (const rp of RETENTION_POLICIES) {
    const id = `rp_${rp.dataCategory}_${rp.jurisdiction}_${rp.serviceType ?? 'none'}`;
    const existing = await prisma.retentionPolicy.findFirst({
      where: {
        dataCategory: rp.dataCategory,
        jurisdiction: rp.jurisdiction,
        serviceType: rp.serviceType ?? null,
      },
    });
    if (existing) {
      await prisma.retentionPolicy.update({
        where: { id: existing.id },
        data: {
          minDays: rp.minDays,
          maxDays: rp.maxDays,
          legalBasis: rp.legalBasis,
        },
      });
    } else {
      await prisma.retentionPolicy.create({
        data: {
          id,
          dataCategory: rp.dataCategory,
          jurisdiction: rp.jurisdiction,
          serviceType: rp.serviceType,
          minDays: rp.minDays,
          maxDays: rp.maxDays,
          legalBasis: rp.legalBasis,
          effectiveFrom: new Date('2026-10-01'),
        },
      });
    }
  }

  // ── Permission Templates (from @nestself/contracts if available) ──
  const templates = await loadPermissionTemplates();
  if (templates) {
    for (const t of templates) {
      await prisma.permissionTemplate.upsert({
        where: { key: t.key },
        update: {
          name: t.name,
          workspace: t.workspace,
          population: t.population,
          actions: [...t.actions],
          scopeType: t.scopeType,
          defaultConditions: (t.defaultConditions ?? undefined) as Parameters<typeof prisma.permissionTemplate.create>[0]['data']['defaultConditions'],
          requiresSecondFactor: t.requiresSecondFactor,
          stepUpActions: [...t.stepUpActions],
          isActive: t.isActive,
        },
        create: {
          key: t.key,
          name: t.name,
          workspace: t.workspace,
          population: t.population,
          actions: [...t.actions],
          scopeType: t.scopeType,
          defaultConditions: (t.defaultConditions ?? undefined) as Parameters<typeof prisma.permissionTemplate.create>[0]['data']['defaultConditions'],
          requiresSecondFactor: t.requiresSecondFactor,
          stepUpActions: [...t.stepUpActions],
          isActive: t.isActive,
        },
      });
    }
  } else {
    console.log(
      'PERMISSION_TEMPLATES not yet exported from @nestself/contracts; skipping template seed.',
    );
  }

  // ── Grants (from legacy roles via PERMISSION_TEMPLATES) ──
  if (templates) {
    interface SeedPerson { id: string; orgId: string | null; orgRole?: string | null; platformRole?: string | null; initials: string; displayName: string; email: string }
    for (const p of SAMPLE_PEOPLE as unknown as readonly SeedPerson[]) {
      if (!p.orgId) continue;

      const legacyRole = p.orgRole ? p.orgRole.toUpperCase() : null;
      const platformRole = p.platformRole ? p.platformRole.toUpperCase() : null;

      // Find which templates map to this user's legacy role
      const matchingTemplates = templates.filter(
        (t) => t.legacyRole === legacyRole || t.legacyRole === platformRole,
      );

      // All org members also get the employee template
      if (legacyRole && !matchingTemplates.some((t) => t.key === 'employee')) {
        const employeeTemplate = templates.find((t) => t.key === 'employee');
        if (employeeTemplate) matchingTemplates.push(employeeTemplate);
      }

      // HR admin user for grantedByUserId
      const hrAdmin = SAMPLE_PEOPLE.find(
        (pp: (typeof SAMPLE_PEOPLE)[number]) => pp.orgRole === 'hr_admin',
      );

      for (const tmpl of matchingTemplates) {
        const grantId = `grant_${p.id}_${tmpl.key}`;

        // Determine scope
        let scopeOrgId: string | null = null;
        let scopeOrgUnitId: string | null = null;
        let includeDescendants = false;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Prisma InputJsonValue
        const conditions: any[] = [];

        if (tmpl.scopeType === 'own' || tmpl.scopeType === 'organization') {
          scopeOrgId = p.orgId;
        } else if (tmpl.scopeType === 'org_unit') {
          scopeOrgId = p.orgId;
          // Use the first team org unit id
          const teamId = SAMPLE_TEAMS[0]?.id ?? null;
          scopeOrgUnitId = teamId;
          includeDescendants = true;
        } else if (tmpl.scopeType === 'platform') {
          // No org scope for platform grants
        } else if (tmpl.scopeType === 'assigned_cases') {
          scopeOrgId = p.orgId;
          // For expert template, add categories condition
          if (tmpl.key === 'expert') {
            const expertRecord = await prisma.expert.findFirst({
              where: { userId: p.id },
              include: { credentials: { where: { status: 'APPROVED' } } },
            });
            if (expertRecord) {
              const categories = expertRecord.credentials.map(
                (c: { serviceCategory: string }) => c.serviceCategory,
              );
              if (categories.length > 0) {
                conditions.push({ type: 'categories', allowed: categories });
              }
            }
          }
        } else {
          scopeOrgId = p.orgId;
        }

        await prisma.grant.upsert({
          where: { id: grantId },
          update: {
            actions: [...tmpl.actions],
            scopeType: tmpl.scopeType,
            scopeOrgId,
            scopeOrgUnitId,
            includeDescendants,
            conditions: conditions.length > 0 ? conditions : undefined,
          },
          create: {
            id: grantId,
            subjectUserId: p.id,
            templateKey: tmpl.key,
            actions: [...tmpl.actions],
            scopeType: tmpl.scopeType,
            scopeOrgId,
            scopeOrgUnitId,
            includeDescendants,
            conditions: conditions.length > 0 ? conditions : undefined,
            grantedByUserId: hrAdmin?.id ?? p.id,
            grantedAt: SAMPLE_START_DATE,
            validFrom: SAMPLE_START_DATE,
          },
        });
      }

      // Operations users: also add Assignment for CLIENT to org_sample
      if (platformRole === 'OPERATIONS') {
        const assignmentId = `assignment_${p.id}_client_${SAMPLE_ORG.id}`;
        await prisma.assignment.upsert({
          where: { id: assignmentId },
          update: {},
          create: {
            id: assignmentId,
            userId: p.id,
            kind: 'CLIENT',
            targetId: SAMPLE_ORG.id,
            assignedByUserId: hrAdmin?.id ?? p.id,
            startAt: SAMPLE_START_DATE,
          },
        });
      }
    }
  }

  // ── Counts ──
  const counts: Record<string, number> = {
    organizations: await prisma.organization.count(),
    teams: await prisma.team.count(),
    orgUnits: await prisma.orgUnit.count(),
    orgUnitClosures: await prisma.orgUnitClosure.count(),
    users: await prisma.user.count(),
    memberships: await prisma.membership.count(),
    channels: await prisma.channel.count(),
    posts: await prisma.post.count(),
    polls: await prisma.poll.count(),
    experts: await prisma.expert.count(),
    expertCredentials: await prisma.expertCredential.count(),
    contentItems: await prisma.contentItem.count(),
    retentionPolicies: await prisma.retentionPolicy.count(),
    permissionTemplates: await prisma.permissionTemplate.count(),
    grants: await prisma.grant.count(),
    assignments: await prisma.assignment.count(),
  };

  return counts;
}
