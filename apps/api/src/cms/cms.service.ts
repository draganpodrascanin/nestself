/**
 * CmsService -- business logic for the M1 content workflow (T-C1.10).
 *
 * Manages content resources, variants, revisions and publications.
 * State transitions follow WRK-R-01..36.
 *
 * Review-fix round: atomic CAS for save/submit/approve, supersession
 * moved to publish, entry-by-entry audience containment, media tracking
 * for image nodes, correction-path coverage check, FOR UPDATE locking.
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  sql,
} from 'drizzle-orm';
import type { Principal } from '@nestself/contracts';
import {
  type ApprovalHashInput,
  approvalHash,
  validateContentDocument,
} from '@nestself/content/schema';
import type {
  ResourceCreateRequest,
  RevisionUpdateRequest,
  PublicationCreateRequest,
  AudienceEntry,
  ResourceListQuery,
  AuthoredLocale,
} from '@nestself/contracts';
import { ACTIONS, AUTHORED_LOCALES } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
import {
  contentResources,
  contentVariants,
  contentRevisions,
  contentRevisionMedia,
  contentPublications,
  contentPublicationAudiences,
} from '../db/schema/cms.js';
import { mediaAssets } from '../db/schema/media.js';
import { organizations, orgUnits } from '../db/schema/organization.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OutboxWriter } from '../notifications/outbox/outbox-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AvailabilityVersionService } from '../library/availability/availability-version.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuthorizationService } from '../authz/authorization.service.js';
import { ApiHttpException } from '../common/api-error.js';

import { extractMediaRefs, extractCtaFromBody, addBusinessDays, checkAudienceContainmentPure } from './cms-helpers.js';

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable()
export class CmsService {
  private readonly logger = new Logger(CmsService.name);
  private readonly linkHostAllowlist: string[];

  constructor(
    private readonly dbService: DbService,
    private readonly auditWriter: AuditWriter,
    private readonly outboxWriter: OutboxWriter,
    private readonly availabilityVersionService: AvailabilityVersionService,
    private readonly authorizationService: AuthorizationService,
    private readonly configService: ConfigService,
  ) {
    const raw = this.configService.get<string>('CONTENT_LINK_HOST_ALLOWLIST') ?? '';
    this.linkHostAllowlist = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // =========================================================================
  // Create resource (WRK-R-01)
  // =========================================================================

  async createResource(
    input: ResourceCreateRequest,
    principal: Principal,
  ) {
    const resourceId = randomUUID();
    const variantId = randomUUID();
    const revisionId = randomUUID();

    const emptyDoc = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
    };

    await this.withPgErrorMapping(async () => {
      await this.dbService.db.transaction(async (tx) => {
        await tx.insert(contentResources).values({
          id: resourceId,
          type: input.type,
          state: 'active',
          primaryCategoryId: input.primaryCategoryId,
          ownerUserId: principal.userId,
          reviewPolicy: input.reviewPolicy,
          reviewDiscipline: input.reviewDiscipline,
        });

        await tx.insert(contentVariants).values({
          id: variantId,
          contentResourceId: resourceId,
          locale: input.locale,
          slug: `${input.type}-${resourceId.slice(0, 8)}-${input.locale}`,
        });

        await tx.insert(contentRevisions).values({
          id: revisionId,
          contentVariantId: variantId,
          revisionNumber: 1,
          state: 'draft',
          body: emptyDoc,
          title: input.title,
          summary: '',
          authorUserId: principal.userId,
          lastEditorUserId: principal.userId,
          lockVersion: 1,
        });
      });
    });

    // Audit AFTER the transaction commits
    await this.auditWriter.record({
      action: 'content.created',
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'content_resource',
      recordId: resourceId,
      result: 'ALLOWED',
      details: { type: input.type, locale: input.locale, categoryId: input.primaryCategoryId },
      sessionId: principal.sessionId ?? null,
    });

    return this.getResourceDetail(resourceId);
  }

  // =========================================================================
  // List resources (category-scoped)
  // =========================================================================

  async listResources(
    categoryIds: string[],
    query: ResourceListQuery,
  ) {
    const conditions = [inArray(contentResources.primaryCategoryId, categoryIds)];
    if (query.state) {
      conditions.push(eq(contentResources.state, query.state));
    }

    if (query.cursor) {
      conditions.push(gt(contentResources.id, query.cursor));
    }

    const limit = query.limit ?? 20;
    const rows = await this.dbService.db
      .select({
        id: contentResources.id,
        type: contentResources.type,
        state: contentResources.state,
        primaryCategoryId: contentResources.primaryCategoryId,
        ownerUserId: contentResources.ownerUserId,
        reviewPolicy: contentResources.reviewPolicy,
        reviewDiscipline: contentResources.reviewDiscipline,
        createdAt: contentResources.createdAt,
        updatedAt: contentResources.updatedAt,
      })
      .from(contentResources)
      .where(and(...conditions))
      .orderBy(asc(contentResources.id))
      .limit(limit + 1);

    const items = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? rows[limit]!.id : null;

    return { items, nextCursor };
  }

  // =========================================================================
  // Resource detail
  // =========================================================================

  async getResourceDetail(resourceId: string) {
    const resourceRows = await this.dbService.db
      .select()
      .from(contentResources)
      .where(eq(contentResources.id, resourceId))
      .limit(1);

    const resource = resourceRows[0];
    if (!resource) return null;

    const variants = await this.dbService.db
      .select()
      .from(contentVariants)
      .where(eq(contentVariants.contentResourceId, resourceId));

    const variantIds = variants.map((v) => v.id);
    const revisions = variantIds.length > 0
      ? await this.dbService.db
          .select()
          .from(contentRevisions)
          .where(inArray(contentRevisions.contentVariantId, variantIds))
          .orderBy(desc(contentRevisions.revisionNumber))
      : [];

    const publications = variantIds.length > 0
      ? await this.dbService.db
          .select()
          .from(contentPublications)
          .where(inArray(contentPublications.contentVariantId, variantIds))
          .orderBy(desc(contentPublications.createdAt))
      : [];

    return {
      ...resource,
      variants: variants.map((v) => ({
        ...v,
        revisions: revisions.filter((r) => r.contentVariantId === v.id),
        publications: publications.filter((p) => p.contentVariantId === v.id),
      })),
    };
  }

  // =========================================================================
  // Add variant (POST /resources/:id/variants)
  // =========================================================================

  async addVariant(
    resourceId: string,
    locale: AuthoredLocale,
    principal: Principal,
    fromLocale?: AuthoredLocale,
  ) {
    if ((locale as string) === 'sr-Cyrl') {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: 'Serbian Cyrillic (sr-Cyrl) is derived at read time and cannot be stored as a variant',
      });
    }

    // Check no existing variant for this locale
    const existing = await this.dbService.db
      .select({ id: contentVariants.id })
      .from(contentVariants)
      .where(
        and(
          eq(contentVariants.contentResourceId, resourceId),
          eq(contentVariants.locale, locale),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      throw new ApiHttpException({
        status: 409,
        code: 'conflict',
        message: `Variant for locale ${locale} already exists`,
      });
    }

    const resource = await this.dbService.db
      .select({ type: contentResources.type })
      .from(contentResources)
      .where(eq(contentResources.id, resourceId))
      .limit(1);
    if (!resource[0]) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }

    const variantId = randomUUID();
    const revisionId = randomUUID();
    const emptyDoc = {
      type: 'doc',
      schemaVersion: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }],
    };

    // Honour fromLocale: copy the latest revision from the source variant
    let sourceRevision: {
      body: unknown;
      title: string;
      summary: string;
      outcome: string | null;
      durationSeconds: number | null;
      difficulty: string | null;
      sources: unknown;
      proposedAudience: unknown;
      cta: unknown;
      relatedResourceIds: string[];
    } | null = null;

    if (fromLocale) {
      const sourceVariantRows = await this.dbService.db
        .select({ id: contentVariants.id })
        .from(contentVariants)
        .where(
          and(
            eq(contentVariants.contentResourceId, resourceId),
            eq(contentVariants.locale, fromLocale),
          ),
        )
        .limit(1);
      if (sourceVariantRows.length > 0) {
        const sourceRevRows = await this.dbService.db
          .select()
          .from(contentRevisions)
          .where(eq(contentRevisions.contentVariantId, sourceVariantRows[0]!.id))
          .orderBy(desc(contentRevisions.revisionNumber))
          .limit(1);
        if (sourceRevRows[0]) {
          sourceRevision = {
            body: sourceRevRows[0].body,
            title: sourceRevRows[0].title,
            summary: sourceRevRows[0].summary,
            outcome: sourceRevRows[0].outcome,
            durationSeconds: sourceRevRows[0].durationSeconds,
            difficulty: sourceRevRows[0].difficulty,
            sources: sourceRevRows[0].sources,
            proposedAudience: sourceRevRows[0].proposedAudience,
            cta: sourceRevRows[0].cta,
            relatedResourceIds: sourceRevRows[0].relatedResourceIds ?? [],
          };
        }
      }
    }

    await this.withPgErrorMapping(async () => {
      await this.dbService.db.transaction(async (tx) => {
        await tx.insert(contentVariants).values({
          id: variantId,
          contentResourceId: resourceId,
          locale,
          slug: `${resource[0]!.type}-${resourceId.slice(0, 8)}-${locale}`,
        });

        await tx.insert(contentRevisions).values({
          id: revisionId,
          contentVariantId: variantId,
          revisionNumber: 1,
          state: 'draft',
          body: sourceRevision?.body ?? emptyDoc,
          title: sourceRevision?.title ?? '',
          summary: sourceRevision?.summary ?? '',
          outcome: sourceRevision?.outcome ?? null,
          durationSeconds: sourceRevision?.durationSeconds ?? null,
          difficulty: sourceRevision?.difficulty ?? null,
          sources: sourceRevision?.sources ?? null,
          proposedAudience: sourceRevision?.proposedAudience ?? null,
          cta: sourceRevision?.cta ?? null,
          relatedResourceIds: sourceRevision?.relatedResourceIds ?? [],
          authorUserId: principal.userId,
          lastEditorUserId: principal.userId,
          lockVersion: 1,
        });
      });
    });

    // Audit AFTER the transaction commits
    await this.auditWriter.record({
      action: 'content.created',
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'content_variant',
      recordId: variantId,
      result: 'ALLOWED',
      details: { locale, resourceId },
      sessionId: principal.sessionId ?? null,
    });

    return this.getRevision(revisionId);
  }

  // =========================================================================
  // Save working revision (PUT) with If-Match -- atomic CAS
  // =========================================================================

  async saveRevision(
    variantId: string,
    revisionId: string,
    body: RevisionUpdateRequest,
    ifMatchVersion: number,
    principal: Principal,
  ) {
    // Validate content document before the atomic write
    if (body.body) {
      const result = validateContentDocument(body.body, {
        linkHostAllowlist: this.linkHostAllowlist,
      });
      if (!result.ok) {
        throw new ApiHttpException({
          status: 400,
          code: result.errors[0]?.code ?? 'content_invalid_block',
          message: result.errors.map((e) => e.message).join('; '),
          details: { errors: result.errors },
        });
      }
      body = { ...body, body: result.document as unknown as Record<string, unknown> };
    }

    // FMT-R-27: CTA is derived from the body only — the top-level `cta`
    // field is not accepted in the write DTO. If the request includes
    // `cta`, reject it.
    if (body.cta !== undefined) {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: 'Top-level cta is read-only; CTA is derived from the body document',
      });
    }

    // Build update set
    const updateSet: Record<string, unknown> = {
      lockVersion: sql`lock_version + 1`,
      lastEditorUserId: principal.userId,
      updatedAt: new Date(),
    };

    if (body.body !== undefined) updateSet.body = body.body;
    if (body.title !== undefined) updateSet.title = body.title;
    if (body.summary !== undefined) updateSet.summary = body.summary;
    if (body.outcome !== undefined) updateSet.outcome = body.outcome;
    if (body.durationSeconds !== undefined) updateSet.durationSeconds = body.durationSeconds;
    if (body.difficulty !== undefined) updateSet.difficulty = body.difficulty;
    if (body.sources !== undefined) updateSet.sources = body.sources;
    if (body.proposedAudience !== undefined) updateSet.proposedAudience = body.proposedAudience;
    if (body.relatedResourceIds !== undefined) updateSet.relatedResourceIds = body.relatedResourceIds;
    if (body.quicklyOutdated !== undefined) updateSet.quicklyOutdated = body.quicklyOutdated;

    // Atomic CAS inside a transaction so media sync is all-or-nothing
    const result = await this.withPgErrorMapping(() => this.dbService.db.transaction(async (tx) => {
      // Extract and validate media refs before the update
      if (body.body) {
        const refs = extractMediaRefs(body.body as Record<string, unknown>);
        if (refs.length > 0) {
          const assetIds = refs.map((r) => r.mediaAssetId);
          const existing = await tx
            .select({ id: mediaAssets.id })
            .from(mediaAssets)
            .where(inArray(mediaAssets.id, assetIds));
          if (existing.length !== new Set(assetIds).size) {
            const existingIds = new Set(existing.map((e) => e.id));
            const unknown = assetIds.filter((id) => !existingIds.has(id));
            throw new ApiHttpException({
              status: 409,
              code: 'media_not_found',
              message: `Unknown media asset ids: ${unknown.join(', ')}`,
            });
          }
        }
      }

      // Atomic UPDATE...WHERE...RETURNING (C-06)
      const updated = await tx
        .update(contentRevisions)
        .set(updateSet)
        .where(
          and(
            eq(contentRevisions.id, revisionId),
            eq(contentRevisions.lockVersion, ifMatchVersion),
            eq(contentRevisions.contentVariantId, variantId),
            inArray(contentRevisions.state, ['draft', 'changes_requested']),
          ),
        )
        .returning();

      if (updated.length === 0) {
        // Re-read to distinguish 404, variant mismatch, or conflict
        const current = await tx
          .select()
          .from(contentRevisions)
          .where(eq(contentRevisions.id, revisionId))
          .limit(1);
        if (!current[0]) {
          throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
        }
        if (current[0].contentVariantId !== variantId) {
          throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found for this variant' });
        }
        if (current[0].state !== 'draft' && current[0].state !== 'changes_requested') {
          throw new ApiHttpException({
            status: 409,
            code: 'content_revision_locked',
            message: 'This revision is locked and cannot be edited',
          });
        }
        throw new ApiHttpException({
          status: 409,
          code: 'content_edit_conflict',
          message: 'The revision has been modified by another session',
          details: {
            lockVersion: current[0].lockVersion,
            updatedAt: current[0].updatedAt,
            title: current[0].title,
            summary: current[0].summary,
            outcome: current[0].outcome,
            durationSeconds: current[0].durationSeconds,
            body: current[0].body,
          },
        });
      }

      // Sync media inside the same transaction
      if (body.body) {
        await this.syncRevisionMedia(tx, revisionId, body.body as Record<string, unknown>);
      }

      // FMT-R-27: derive CTA from the effective body (the one now stored)
      // and persist it in the same transaction.
      const effectiveBody = (body.body ?? updated[0]!.body) as Record<string, unknown>;
      const derivedCta = extractCtaFromBody(effectiveBody);
      await tx
        .update(contentRevisions)
        .set({ cta: derivedCta })
        .where(eq(contentRevisions.id, revisionId));
      updated[0] = { ...updated[0]!, cta: derivedCta };

      return updated[0]!;
    }));

    // Audit after commit
    await this.auditWriter.record({
      action: 'content.updated',
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'content_revision',
      recordId: revisionId,
      result: 'ALLOWED',
      sessionId: principal.sessionId ?? null,
    });

    return result;
  }

  // =========================================================================
  // Create new working revision (POST variants/:id/revisions, WRK-R-02)
  // =========================================================================

  async createNewWorkingRevision(
    variantId: string,
    principal: Principal,
  ) {
    const newRevisionId = randomUUID();

    await this.withPgErrorMapping(async () => {
      await this.dbService.db.transaction(async (tx) => {
        // Serialize concurrent callers by locking the parent variant row.
        // Without this, two requests can both pass the "no draft exists" check
        // and both insert, producing two draft revisions or a 500.
        await tx.execute(
          sql`SELECT id FROM content_variants WHERE id = ${variantId} FOR UPDATE`,
        );

        // Re-check under the lock
        const existing = await tx
          .select({ id: contentRevisions.id })
          .from(contentRevisions)
          .where(
            and(
              eq(contentRevisions.contentVariantId, variantId),
              inArray(contentRevisions.state, ['draft', 'changes_requested']),
            ),
          )
          .limit(1);

        if (existing.length > 0) {
          throw new ApiHttpException({
            status: 409,
            code: 'content_not_submittable',
            message: 'A working revision already exists for this variant',
          });
        }

        // Find the source revision to copy from (WRK-R-02)
        const sourceRows = await tx
          .select()
          .from(contentRevisions)
          .where(eq(contentRevisions.contentVariantId, variantId))
          .orderBy(
            sql`CASE WHEN state = 'approved' THEN 0 ELSE 1 END`,
            desc(contentRevisions.revisionNumber),
          )
          .limit(1);

        const source = sourceRows[0];

        // Get current max revision number
        const maxRevResult = await tx
          .select({ max: sql<number>`COALESCE(MAX(revision_number), 0)` })
          .from(contentRevisions)
          .where(eq(contentRevisions.contentVariantId, variantId));
        const nextRevisionNumber = (maxRevResult[0]?.max ?? 0) + 1;

        await tx.insert(contentRevisions).values({
          id: newRevisionId,
          contentVariantId: variantId,
          revisionNumber: nextRevisionNumber,
          state: 'draft',
          body: source?.body ?? { type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text: ' ' }] }] },
          title: source?.title ?? '',
          summary: source?.summary ?? '',
          outcome: source?.outcome ?? null,
          durationSeconds: source?.durationSeconds ?? null,
          difficulty: source?.difficulty ?? null,
          sources: source?.sources ?? null,
          proposedAudience: source?.proposedAudience ?? null,
          cta: source?.cta ?? null,
          relatedResourceIds: source?.relatedResourceIds ?? [],
          authorUserId: principal.userId,
          lastEditorUserId: principal.userId,
          lockVersion: 1,
        });

        // Copy content_revision_media rows from source (WRK-R-02 media carry)
        if (source) {
          const sourceMedia = await tx
            .select()
            .from(contentRevisionMedia)
            .where(eq(contentRevisionMedia.contentRevisionId, source.id));
          for (const m of sourceMedia) {
            await tx.insert(contentRevisionMedia).values({
              id: randomUUID(),
              contentRevisionId: newRevisionId,
              mediaAssetId: m.mediaAssetId,
              usageKind: m.usageKind,
            });
          }
        }
      });
    });

    // Audit AFTER the transaction commits
    await this.auditWriter.record({
      action: 'content.created',
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'content_revision',
      recordId: newRevisionId,
      result: 'ALLOWED',
      details: { variantId },
      sessionId: principal.sessionId ?? null,
    });

    return this.getRevision(newRevisionId);
  }

  // =========================================================================
  // Submit revision (POST revisions/:id/submit) -- atomic CAS
  // =========================================================================

  async submitRevision(
    revisionId: string,
    principal: Principal,
  ) {
    // Atomic: lock revision row, validate, transition, outbox -- all in one tx (ARC-R-08)
    const updated = await this.withPgErrorMapping(() => this.dbService.db.transaction(async (tx) => {
      // Lock the revision row to serialize concurrent submits
      const lockedRows = await tx.execute(
        sql`SELECT * FROM content_revisions WHERE id = ${revisionId} FOR UPDATE`,
      );
      const rev = lockedRows.rows?.[0] as Record<string, unknown> | undefined;
      if (!rev) {
        throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
      }

      const now = new Date();

      if (rev.state !== 'draft' && rev.state !== 'changes_requested') {
        throw new ApiHttpException({
          status: 409,
          code: 'content_not_submittable',
          message: `Cannot submit a revision in state ${rev.state as string}`,
        });
      }

      // C-12: proposedAudience is required at submit (fail-closed)
      if (!rev.proposed_audience || !Array.isArray(rev.proposed_audience) || (rev.proposed_audience as unknown[]).length === 0) {
        throw new ApiHttpException({
          status: 400,
          code: 'content_missing_required',
          message: 'proposedAudience is required before submitting for review',
          details: { field: 'proposedAudience' },
        });
      }

      // Validate document
      const body = rev.body as Record<string, unknown>;
      const validationResult = validateContentDocument(body, {
        linkHostAllowlist: this.linkHostAllowlist,
      });
      if (!validationResult.ok) {
        throw new ApiHttpException({
          status: 400,
          code: 'content_not_submittable',
          message: validationResult.errors.map((e) => e.message).join('; '),
          details: { errors: validationResult.errors },
        });
      }

      // Check media readiness inside the transaction
      await this.checkMediaReadyTx(tx, revisionId);

      // Atomic state transition
      const result = await tx
        .update(contentRevisions)
        .set({
          state: 'in_review',
          submittedAt: now,
          reviewDueAt: addBusinessDays(now, 2),
          updatedAt: now,
        })
        .where(
          and(
            eq(contentRevisions.id, revisionId),
            inArray(contentRevisions.state, ['draft', 'changes_requested']),
          ),
        )
        .returning();

      if (result.length === 0) {
        throw new ApiHttpException({
          status: 409,
          code: 'content_not_submittable',
          message: 'The revision state changed concurrently',
        });
      }

      // Outbox in same transaction (ARC-R-08)
      await this.outboxWriter.write(tx, {
        type: 'content.review_requested',
        aggregateType: 'content_revision',
        aggregateId: revisionId,
        payload: { revisionId },
      });

      return result[0]!;
    }));

    // Audit AFTER the transaction commits
    await this.auditWriter.record({
      action: 'content.submitted',
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'content_revision',
      recordId: revisionId,
      result: 'ALLOWED',
      sessionId: principal.sessionId ?? null,
    });

    return updated;
  }

  // =========================================================================
  // Approve revision (POST revisions/:id/approve) -- atomic CAS
  // =========================================================================

  async approveRevision(
    revisionId: string,
    principal: Principal,
  ) {
    const updated = await this.withPgErrorMapping(() => this.dbService.db.transaction(async (tx) => {
      // Lock order: resource first, then variant (sorted by id in multi-variant cases)
      // Step 1: load revision + resource context via join
      const contextRows = await tx
        .select({
          revId: contentRevisions.id,
          revState: contentRevisions.state,
          revBody: contentRevisions.body,
          revTitle: contentRevisions.title,
          revSummary: contentRevisions.summary,
          revOutcome: contentRevisions.outcome,
          revDurationSeconds: contentRevisions.durationSeconds,
          revDifficulty: contentRevisions.difficulty,
          revSources: contentRevisions.sources,
          revCta: contentRevisions.cta,
          revRelatedResourceIds: contentRevisions.relatedResourceIds,
          revProposedAudience: contentRevisions.proposedAudience,
          revRevisionNumber: contentRevisions.revisionNumber,
          revAuthorUserId: contentRevisions.authorUserId,
          revLastEditorUserId: contentRevisions.lastEditorUserId,
          variantId: contentVariants.id,
          locale: contentVariants.locale,
          resourceId: contentResources.id,
          reviewDiscipline: contentResources.reviewDiscipline,
          reviewPolicy: contentResources.reviewPolicy,
        })
        .from(contentRevisions)
        .innerJoin(contentVariants, eq(contentRevisions.contentVariantId, contentVariants.id))
        .innerJoin(contentResources, eq(contentVariants.contentResourceId, contentResources.id))
        .where(eq(contentRevisions.id, revisionId))
        .limit(1);

      const ctx = contextRows[0];
      if (!ctx) {
        throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
      }

      if (ctx.revState !== 'in_review') {
        throw new ApiHttpException({
          status: 409,
          code: 'content_revision_locked',
          message: `Cannot approve a revision in state ${ctx.revState}`,
        });
      }

      // ACC-R-08: Self-review check (5.5)
      if (ctx.revAuthorUserId === principal.userId || ctx.revLastEditorUserId === principal.userId) {
        throw new ApiHttpException({
          status: 403,
          code: 'content_self_review',
          message: 'A reviewer cannot approve a revision they authored or last edited',
        });
      }

      // ACC-R-07 fail-closed: discipline check (defense in depth)
      if (!ctx.reviewDiscipline) {
        throw new ApiHttpException({
          status: 403,
          code: 'content_review_discipline',
          message: 'The resource has no review discipline configured',
        });
      }

      // Lock order: resource row first
      await tx.execute(
        sql`SELECT id FROM content_resources WHERE id = ${ctx.resourceId} FOR UPDATE`,
      );

      // Then variant row (FOR UPDATE on variant serializes concurrent approvals)
      await tx.execute(
        sql`SELECT id FROM content_variants WHERE id = ${ctx.variantId} FOR UPDATE`,
      );

      const now = new Date();

      // Check: if a newer revision of the same variant is approved or in_review → 409
      const newerLocked = await tx
        .select({ id: contentRevisions.id })
        .from(contentRevisions)
        .where(
          and(
            eq(contentRevisions.contentVariantId, ctx.variantId),
            inArray(contentRevisions.state, ['approved', 'in_review']),
            gt(contentRevisions.revisionNumber, ctx.revRevisionNumber),
          ),
        )
        .limit(1);

      if (newerLocked.length > 0) {
        throw new ApiHttpException({
          status: 409,
          code: 'content_revision_locked',
          message: 'A newer revision is already approved or in review for this variant',
        });
      }

      // Get media asset ids for the hash
      const mediaRows = await tx
        .select({ mediaAssetId: contentRevisionMedia.mediaAssetId })
        .from(contentRevisionMedia)
        .where(eq(contentRevisionMedia.contentRevisionId, revisionId));
      const mediaAssetIds = mediaRows.map((r) => r.mediaAssetId);

      // Compute approval hash (FMT-R-08)
      const hashInput: ApprovalHashInput = {
        body: ctx.revBody,
        title: ctx.revTitle,
        summary: ctx.revSummary,
        outcome: ctx.revOutcome ?? null,
        durationSeconds: ctx.revDurationSeconds ?? 0,
        difficulty: ctx.revDifficulty ?? '',
        sources: Array.isArray(ctx.revSources) ? (ctx.revSources as string[]) : [],
        locale: ctx.locale,
        mediaAssetIds,
        relatedResourceIds: ctx.revRelatedResourceIds ?? [],
        cta: ctx.revCta,
        reviewDiscipline: ctx.reviewDiscipline,
        proposedAudience: ctx.revProposedAudience,
      };
      const hash = await approvalHash(hashInput);

      // Atomic state transition -- no supersession at approve time
      const result = await tx
        .update(contentRevisions)
        .set({
          state: 'approved',
          approvedAt: now,
          approvedByUserId: principal.userId,
          approvalHash: hash,
          updatedAt: now,
        })
        .where(
          and(
            eq(contentRevisions.id, revisionId),
            eq(contentRevisions.state, 'in_review'),
          ),
        )
        .returning();

      if (result.length === 0) {
        throw new ApiHttpException({
          status: 409,
          code: 'content_revision_locked',
          message: 'The revision state changed concurrently',
        });
      }

      // Outbox in same transaction (ARC-R-08)
      await this.outboxWriter.write(tx, {
        type: 'content.approved',
        aggregateType: 'content_revision',
        aggregateId: revisionId,
        payload: { revisionId },
      });

      return result[0]!;
    }));

    // Audit AFTER the transaction commits
    await this.auditWriter.record({
      action: 'content.approved',
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'content_revision',
      recordId: revisionId,
      result: 'ALLOWED',
      sessionId: principal.sessionId ?? null,
    });

    return updated;
  }

  // =========================================================================
  // Return for changes (POST revisions/:id/return)
  // =========================================================================

  /**
   * WRK-R-06: moves an in-review revision to `changes_requested` under the
   * same reviewer rules as approve. The comment travels in the outbox payload
   * until T-C2.01 adds `content_revision_reviews` and shows it to the author.
   */
  async returnForChanges(
    revisionId: string,
    comment: string,
    principal: Principal,
  ) {
    const updated = await this.withPgErrorMapping(() => this.dbService.db.transaction(async (tx) => {
      // Load revision + context
      const contextRows = await tx
        .select({
          revId: contentRevisions.id,
          revState: contentRevisions.state,
          revAuthorUserId: contentRevisions.authorUserId,
          revLastEditorUserId: contentRevisions.lastEditorUserId,
          variantId: contentVariants.id,
          resourceId: contentResources.id,
          reviewDiscipline: contentResources.reviewDiscipline,
        })
        .from(contentRevisions)
        .innerJoin(contentVariants, eq(contentRevisions.contentVariantId, contentVariants.id))
        .innerJoin(contentResources, eq(contentVariants.contentResourceId, contentResources.id))
        .where(eq(contentRevisions.id, revisionId))
        .limit(1);

      const ctx = contextRows[0];
      if (!ctx) {
        throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
      }

      if (ctx.revState !== 'in_review') {
        throw new ApiHttpException({
          status: 409,
          code: 'content_revision_locked',
          message: `Cannot return a revision in state ${ctx.revState}`,
        });
      }

      // ACC-R-08: self-review check
      if (ctx.revAuthorUserId === principal.userId || ctx.revLastEditorUserId === principal.userId) {
        throw new ApiHttpException({
          status: 403,
          code: 'content_self_review',
          message: 'A reviewer cannot return a revision they authored or last edited',
        });
      }

      // ACC-R-07 fail-closed: discipline check (defense in depth)
      if (!ctx.reviewDiscipline) {
        throw new ApiHttpException({
          status: 403,
          code: 'content_review_discipline',
          message: 'The resource has no review discipline configured',
        });
      }

      // Lock order: resource, then variant
      await tx.execute(
        sql`SELECT id FROM content_resources WHERE id = ${ctx.resourceId} FOR UPDATE`,
      );
      await tx.execute(
        sql`SELECT id FROM content_variants WHERE id = ${ctx.variantId} FOR UPDATE`,
      );

      const now = new Date();

      const result = await tx
        .update(contentRevisions)
        .set({
          state: 'changes_requested',
          updatedAt: now,
        })
        .where(
          and(
            eq(contentRevisions.id, revisionId),
            eq(contentRevisions.state, 'in_review'),
          ),
        )
        .returning();

      if (result.length === 0) {
        throw new ApiHttpException({
          status: 409,
          code: 'content_revision_locked',
          message: 'The revision state changed concurrently',
        });
      }

      // Outbox in same transaction (ARC-R-08)
      await this.outboxWriter.write(tx, {
        type: 'content.changes_requested',
        aggregateType: 'content_revision',
        aggregateId: revisionId,
        payload: { revisionId, comment },
      });

      return result[0]!;
    }));

    // Audit AFTER the transaction commits
    await this.auditWriter.record({
      action: 'content.changes_requested',
      actorUserId: principal.userId,
      actorKind: 'USER',
      recordType: 'content_revision',
      recordId: revisionId,
      result: 'ALLOWED',
      sessionId: principal.sessionId ?? null,
    });

    return updated;
  }

  // =========================================================================
  // Publish now (POST publications)
  // =========================================================================

  async publishNow(
    input: PublicationCreateRequest,
    principal: Principal,
  ) {
    const publicationIds: string[] = [];
    // Track superseded publications' audience org ids for availability bump
    const supersededOrgIds = new Set<string>();

    // WRK-R-32: content.restrict authorization check runs BEFORE the
    // transaction opens so it does not acquire a second pooled connection
    // while the transaction holds one (defect 6c).
    const preResource = await this.dbService.db
      .select({
        id: contentResources.id,
        primaryCategoryId: contentResources.primaryCategoryId,
        reviewDiscipline: contentResources.reviewDiscipline,
      })
      .from(contentResources)
      .where(eq(contentResources.id, input.resourceId))
      .limit(1);
    if (!preResource[0]) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }
    await this.authorizationService.require(principal, ACTIONS['content.restrict'], {
      type: 'content_resource',
      id: preResource[0].id,
      collectionId: preResource[0].primaryCategoryId ?? undefined,
    });

    await this.withPgErrorMapping(async () => {
    await this.dbService.db.transaction(async (tx) => {
      // Lock the resource row FIRST inside the transaction (prevent concurrent publishes)
      const resourceLockRows = await tx.execute(
        sql`SELECT * FROM content_resources WHERE id = ${input.resourceId} FOR UPDATE`,
      );
      const resource = resourceLockRows.rows?.[0] as {
        id: string;
        primary_category_id: string | null;
        review_discipline: string | null;
      } | undefined;
      if (!resource) {
        throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
      }

      // Compute now AFTER the resource lock so all timestamps are post-lock
      const now = new Date();

      // Get all variants (inside the transaction to see a consistent snapshot)
      const variants = await tx
        .select()
        .from(contentVariants)
        .where(eq(contentVariants.contentResourceId, input.resourceId));

      // Determine which locales to publish
      const requestedLocales = input.locales ?? [...AUTHORED_LOCALES];

      // WRK-R-36: locale completeness check
      if (!input.locales) {
        // Full publish: all authored locales must have an approved revision
        const missingLocales: string[] = [];
        for (const locale of AUTHORED_LOCALES) {
          const variant = variants.find((v) => v.locale === locale);
          if (!variant) {
            missingLocales.push(locale);
            continue;
          }
          const approvedRev = await tx
            .select({ id: contentRevisions.id })
            .from(contentRevisions)
            .where(
              and(
                eq(contentRevisions.contentVariantId, variant.id),
                eq(contentRevisions.state, 'approved'),
              ),
            )
            .limit(1);
          if (approvedRev.length === 0) {
            missingLocales.push(locale);
          }
        }
        if (missingLocales.length > 0) {
          throw new ApiHttpException({
            status: 409,
            code: 'content_locale_incomplete',
            message: 'Not all authored locales have an approved revision',
            details: { missingLocales },
          });
        }
      } else {
        // Correction path: specified locales need approved revisions,
        // ALL OTHER authored locales must have a current live publication.
        for (const locale of requestedLocales) {
          const variant = variants.find((v) => v.locale === locale);
          if (!variant) {
            throw new ApiHttpException({
              status: 409,
              code: 'content_locale_incomplete',
              message: `No variant exists for locale ${locale}`,
              details: { missingLocales: [locale] },
            });
          }
          const approvedRev = await tx
            .select({ id: contentRevisions.id })
            .from(contentRevisions)
            .where(
              and(
                eq(contentRevisions.contentVariantId, variant.id),
                eq(contentRevisions.state, 'approved'),
              ),
            )
            .limit(1);
          if (approvedRev.length === 0) {
            throw new ApiHttpException({
              status: 409,
              code: 'content_locale_incomplete',
              message: `No approved revision for locale ${locale}`,
              details: { missingLocales: [locale] },
            });
          }
        }

        // Check that locales NOT in the correction set have live publications
        const otherLocales = AUTHORED_LOCALES.filter((l) => !requestedLocales.includes(l));
        for (const locale of otherLocales) {
          const variant = variants.find((v) => v.locale === locale);
          if (!variant) {
            // No variant for this locale and not correcting it — needs a live pub
            throw new ApiHttpException({
              status: 409,
              code: 'content_locale_incomplete',
              message: `Locale ${locale} has no variant and no live publication (correction requires existing coverage)`,
              details: { missingLocales: [locale] },
            });
          }
          const livePub = await tx
            .select({ id: contentPublications.id })
            .from(contentPublications)
            .where(
              and(
                eq(contentPublications.contentVariantId, variant.id),
                eq(contentPublications.state, 'live'),
                isNull(contentPublications.withdrawnAt),
              ),
            )
            .limit(1);
          if (livePub.length === 0) {
            throw new ApiHttpException({
              status: 409,
              code: 'content_locale_incomplete',
              message: `Locale ${locale} has no live publication (correction requires existing coverage)`,
              details: { missingLocales: [locale] },
            });
          }
        }
      }

      // Lock variants by id ascending to match the lock order used by
      // approve and new-working-revision, preventing deadlocks (P14).
      const requestedVariants = requestedLocales
        .map((locale) => variants.find((v) => v.locale === locale))
        .filter((v): v is NonNullable<typeof v> => v != null)
        .sort((a, b) => a.id.localeCompare(b.id));

      for (const variant of requestedVariants) {

        // WRK-R-34: serialize with FOR UPDATE on the variant
        const lockedVariant = await tx.execute(
          sql`SELECT id FROM content_variants WHERE id = ${variant.id} FOR UPDATE`,
        );
        if (!lockedVariant.rows || lockedVariant.rows.length === 0) continue;

        // Get the latest approved revision
        const approvedRevRows = await tx
          .select()
          .from(contentRevisions)
          .where(
            and(
              eq(contentRevisions.contentVariantId, variant.id),
              eq(contentRevisions.state, 'approved'),
            ),
          )
          .orderBy(desc(contentRevisions.revisionNumber))
          .limit(1);

        const approvedRev = approvedRevRows[0];
        if (!approvedRev) continue;

        // Check for existing publication of same revision (WRK-R-34)
        const existingPub = await tx
          .select({ id: contentPublications.id })
          .from(contentPublications)
          .where(
            and(
              eq(contentPublications.contentRevisionId, approvedRev.id),
              isNull(contentPublications.withdrawnAt),
            ),
          )
          .limit(1);

        if (existingPub.length > 0) {
          throw new ApiHttpException({
            status: 409,
            code: 'content_publication_exists',
            message: `A publication already exists for revision ${approvedRev.id}`,
          });
        }

        // Check media readiness at publish time
        await this.checkMediaReadyTx(tx, approvedRev.id);

        // Recompute approval hash and verify (FMT-R-09)
        const mediaRows = await tx
          .select({ mediaAssetId: contentRevisionMedia.mediaAssetId })
          .from(contentRevisionMedia)
          .where(eq(contentRevisionMedia.contentRevisionId, approvedRev.id));
        const mediaAssetIds = mediaRows.map((r) => r.mediaAssetId);

        const hashInput: ApprovalHashInput = {
          body: approvedRev.body,
          title: approvedRev.title,
          summary: approvedRev.summary,
          outcome: approvedRev.outcome ?? null,
          durationSeconds: approvedRev.durationSeconds ?? 0,
          difficulty: approvedRev.difficulty ?? '',
          sources: Array.isArray(approvedRev.sources) ? (approvedRev.sources as string[]) : [],
          locale: variant.locale,
          mediaAssetIds,
          relatedResourceIds: approvedRev.relatedResourceIds ?? [],
          cta: approvedRev.cta,
          reviewDiscipline: resource.review_discipline ?? '',
          proposedAudience: approvedRev.proposedAudience,
        };
        const recomputedHash = await approvalHash(hashInput);

        if (recomputedHash !== approvedRev.approvalHash) {
          throw new ApiHttpException({
            status: 409,
            code: 'content_approval_stale',
            message: 'The revision content has changed since approval',
          });
        }

        // WRK-R-38: validate org/unit IDs exist before containment check
        await this.validateAudienceIds(tx, input.audience);

        // Entry-by-entry audience containment (C-12)
        await this.checkAudienceContainment(tx, input.audience, approvedRev.proposedAudience);

        // Supersession: mark older approved revisions as superseded (moved from approve)
        // Bound: only supersede revisions with revision_number < the one being published
        await tx
          .update(contentRevisions)
          .set({ state: 'superseded', updatedAt: now })
          .where(
            and(
              eq(contentRevisions.contentVariantId, variant.id),
              eq(contentRevisions.state, 'approved'),
              ne(contentRevisions.id, approvedRev.id),
              lt(contentRevisions.revisionNumber, approvedRev.revisionNumber),
            ),
          );

        // Supersession: end only live publications of the same variant whose
        // revision has a lower revision_number than the one being published,
        // including those with a future ends_at.
        const previousPubs = await tx
          .select({
            id: contentPublications.id,
            endsAt: contentPublications.endsAt,
            revisionNumber: contentRevisions.revisionNumber,
          })
          .from(contentPublications)
          .innerJoin(contentRevisions, eq(contentPublications.contentRevisionId, contentRevisions.id))
          .where(
            and(
              eq(contentPublications.contentVariantId, variant.id),
              eq(contentPublications.state, 'live'),
              isNull(contentPublications.withdrawnAt),
              lt(contentRevisions.revisionNumber, approvedRev.revisionNumber),
            ),
          );

        if (previousPubs.length > 0) {
          // Collect audience org ids from superseded publications for availability bump
          for (const prevPub of previousPubs) {
            const prevAuds = await tx
              .select({ orgId: contentPublicationAudiences.orgId, kind: contentPublicationAudiences.kind })
              .from(contentPublicationAudiences)
              .where(eq(contentPublicationAudiences.publicationId, prevPub.id));
            for (const a of prevAuds) {
              if (a.kind === 'all_eligible') {
                supersededOrgIds.add('__global__');
              } else if (a.orgId) {
                supersededOrgIds.add(a.orgId);
              }
            }
          }

          // Set ends_at (overwrite future ends_at too, since this is supersession)
          const pubIdsToEnd = previousPubs.map((p) => p.id);
          await tx
            .update(contentPublications)
            .set({ endsAt: now })
            .where(inArray(contentPublications.id, pubIdsToEnd));
        }

        // Create the publication
        const pubId = randomUUID();
        publicationIds.push(pubId);

        await tx.insert(contentPublications).values({
          id: pubId,
          contentVariantId: variant.id,
          contentRevisionId: approvedRev.id,
          approvalHash: recomputedHash,
          state: 'live',
          requiredCapability: 'library',
          startsAt: now,
          publishedByUserId: principal.userId,
        });

        // Audience rows
        for (const aud of input.audience) {
          await tx.insert(contentPublicationAudiences).values({
            id: randomUUID(),
            publicationId: pubId,
            kind: aud.kind,
            orgId: aud.orgId ?? null,
            orgUnitId: aud.orgUnitId ?? null,
            includeDescendants: aud.includeDescendants ?? true,
          });
        }

        await this.outboxWriter.write(tx, {
          type: 'publication.started',
          aggregateType: 'content_publication',
          aggregateId: pubId,
          payload: { publicationId: pubId, resourceId: input.resourceId, locale: variant.locale },
        });
      }
    });
    }); // withPgErrorMapping

    // Audit AFTER the transaction commits
    for (const pubId of publicationIds) {
      await this.auditWriter.record({
        action: 'publication.created',
        actorUserId: principal.userId,
        actorKind: 'USER',
        recordType: 'content_publication',
        recordId: pubId,
        result: 'ALLOWED',
        sessionId: principal.sessionId ?? null,
      });
    }

    // Bump availability version for both new and superseded audiences
    const newOrgIds = new Set(
      input.audience.filter((a) => a.orgId).map((a) => a.orgId!),
    );
    const newHasAllEligible = input.audience.some((a) => a.kind === 'all_eligible');
    const supersededHasGlobal = supersededOrgIds.has('__global__');

    if (newHasAllEligible || supersededHasGlobal) {
      await this.availabilityVersionService.bump('global');
    } else {
      // Merge org ids from new and superseded audiences
      const allOrgIds = new Set([...newOrgIds, ...supersededOrgIds]);
      allOrgIds.delete('__global__');
      if (allOrgIds.size > 0) {
        await this.availabilityVersionService.bump([...allOrgIds]);
      }
    }

    // WRK-R-37: return all publications keyed by locale
    if (publicationIds.length === 0) {
      throw new ApiHttpException({ status: 500, code: 'internal', message: 'No publications created' });
    }

    const publications = [];
    for (const pubId of publicationIds) {
      const pub = await this.getPublication(pubId);
      if (pub) publications.push(pub);
    }
    return { publications };
  }

  // =========================================================================
  // Media asset detail (GET /ops/cms/media/:assetId)
  // =========================================================================

  async getMediaAsset(assetId: string) {
    const rows = await this.dbService.db
      .select()
      .from(mediaAssets)
      .where(eq(mediaAssets.id, assetId))
      .limit(1);
    if (!rows[0]) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Asset not found' });
    }
    return rows[0];
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  async getRevision(revisionId: string) {
    const rows = await this.dbService.db
      .select()
      .from(contentRevisions)
      .where(eq(contentRevisions.id, revisionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getPublication(publicationId: string) {
    const rows = await this.dbService.db
      .select()
      .from(contentPublications)
      .where(eq(contentPublications.id, publicationId))
      .limit(1);
    if (!rows[0]) return null;

    const audiences = await this.dbService.db
      .select()
      .from(contentPublicationAudiences)
      .where(eq(contentPublicationAudiences.publicationId, publicationId));

    return { ...rows[0], audiences };
  }

  private async loadRevisionOrThrow(revisionId: string) {
    const rows = await this.dbService.db
      .select()
      .from(contentRevisions)
      .where(eq(contentRevisions.id, revisionId))
      .limit(1);
    const rev = rows[0];
    if (!rev) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
    }
    return rev;
  }

  private async checkMediaReady(revisionId: string): Promise<void> {
    const mediaRows = await this.dbService.db
      .select({
        mediaAssetId: contentRevisionMedia.mediaAssetId,
        state: mediaAssets.state,
        rightsExpiresAt: mediaAssets.rightsExpiresAt,
      })
      .from(contentRevisionMedia)
      .innerJoin(mediaAssets, eq(contentRevisionMedia.mediaAssetId, mediaAssets.id))
      .where(eq(contentRevisionMedia.contentRevisionId, revisionId));

    for (const row of mediaRows) {
      if (row.state !== 'ready') {
        throw new ApiHttpException({
          status: 409,
          code: 'media_not_ready',
          message: `Media asset ${row.mediaAssetId} is not ready (state: ${row.state})`,
        });
      }
      if (row.rightsExpiresAt && row.rightsExpiresAt < new Date()) {
        throw new ApiHttpException({
          status: 409,
          code: 'media_rights_expired',
          message: `Media asset ${row.mediaAssetId} has expired rights`,
        });
      }
    }
  }

  /**
   * Transaction-aware media readiness check for publish.
   */
  private async checkMediaReadyTx(
    tx: Parameters<Parameters<typeof this.dbService.db.transaction>[0]>[0],
    revisionId: string,
  ): Promise<void> {
    const mediaRows = await tx
      .select({
        mediaAssetId: contentRevisionMedia.mediaAssetId,
        state: mediaAssets.state,
        rightsExpiresAt: mediaAssets.rightsExpiresAt,
      })
      .from(contentRevisionMedia)
      .innerJoin(mediaAssets, eq(contentRevisionMedia.mediaAssetId, mediaAssets.id))
      .where(eq(contentRevisionMedia.contentRevisionId, revisionId));

    for (const row of mediaRows) {
      if (row.state !== 'ready') {
        throw new ApiHttpException({
          status: 409,
          code: 'media_not_ready',
          message: `Media asset ${row.mediaAssetId} is not ready (state: ${row.state})`,
        });
      }
      if (row.rightsExpiresAt && row.rightsExpiresAt < new Date()) {
        throw new ApiHttpException({
          status: 409,
          code: 'media_rights_expired',
          message: `Media asset ${row.mediaAssetId} has expired rights`,
        });
      }
    }
  }

  /**
   * Entry-by-entry audience containment check (C-12).
   *
   * Delegates the pure containment logic to `checkAudienceContainmentPure`
   * in cms-helpers.ts (shared with unit tests), then performs the DB-only
   * org_unit → org membership verification.
   */
  private async checkAudienceContainment(
    tx: Parameters<Parameters<typeof this.dbService.db.transaction>[0]>[0],
    publishAudience: AudienceEntry[],
    proposedAudience: unknown,
  ): Promise<void> {
    // Pure containment check (throws on violation)
    checkAudienceContainmentPure(publishAudience, proposedAudience);

    // DB-only: verify org_unit entries actually belong to their stated org
    for (const pub of publishAudience) {
      if (pub.kind === 'org_unit' && pub.orgUnitId) {
        const unitRows = await tx
          .select({ orgId: orgUnits.orgId })
          .from(orgUnits)
          .where(eq(orgUnits.id, pub.orgUnitId))
          .limit(1);
        if (unitRows.length > 0 && unitRows[0]!.orgId !== pub.orgId) {
          throw new ApiHttpException({
            status: 403,
            code: 'content_audience_exceeds_approval',
            message: `Org unit ${pub.orgUnitId} does not belong to organization ${pub.orgId}`,
          });
        }
      }
    }
  }

  /**
   * Sync content_revision_media from the document's media nodes.
   * Maps `image` → `inline_image`, `approvedMedia` → `body_media`.
   *
   * Runs inside the caller's transaction.
   */
  private async syncRevisionMedia(
    tx: Parameters<Parameters<typeof this.dbService.db.transaction>[0]>[0],
    revisionId: string,
    doc: Record<string, unknown>,
  ): Promise<void> {
    const refs = extractMediaRefs(doc);

    // Delete existing and re-insert
    await tx
      .delete(contentRevisionMedia)
      .where(eq(contentRevisionMedia.contentRevisionId, revisionId));

    for (const ref of refs) {
      await tx.insert(contentRevisionMedia).values({
        id: randomUUID(),
        contentRevisionId: revisionId,
        mediaAssetId: ref.mediaAssetId,
        usageKind: ref.usageKind,
      });
    }
  }

  // =========================================================================
  // Audience ID validation (WRK-R-38)
  // =========================================================================

  /**
   * Verify that every org and org-unit id in the audience entries actually
   * exists, and that each org-unit belongs to its stated org.
   * Throws 400 on unknown ids.
   */
  private async validateAudienceIds(
    tx: Parameters<Parameters<typeof this.dbService.db.transaction>[0]>[0],
    audience: AudienceEntry[],
  ): Promise<void> {
    for (const entry of audience) {
      if (entry.orgId) {
        const orgRows = await tx
          .select({ id: organizations.id })
          .from(organizations)
          .where(eq(organizations.id, entry.orgId))
          .limit(1);
        if (orgRows.length === 0) {
          throw new ApiHttpException({
            status: 400,
            code: 'validation',
            message: `Organization ${entry.orgId} not found`,
            details: { orgId: entry.orgId },
          });
        }
      }
      if (entry.orgUnitId) {
        const unitRows = await tx
          .select({ id: orgUnits.id, orgId: orgUnits.orgId })
          .from(orgUnits)
          .where(eq(orgUnits.id, entry.orgUnitId))
          .limit(1);
        if (unitRows.length === 0) {
          throw new ApiHttpException({
            status: 400,
            code: 'validation',
            message: `Org unit ${entry.orgUnitId} not found`,
            details: { orgUnitId: entry.orgUnitId },
          });
        }
        if (entry.orgId && unitRows[0]!.orgId !== entry.orgId) {
          throw new ApiHttpException({
            status: 400,
            code: 'validation',
            message: `Org unit ${entry.orgUnitId} does not belong to organization ${entry.orgId}`,
            details: { orgUnitId: entry.orgUnitId, orgId: entry.orgId },
          });
        }
      }
    }
  }

  // =========================================================================
  // Belt-and-braces: map PostgreSQL unique_violation to 409
  // =========================================================================

  /**
   * Wrap a CMS write so that PostgreSQL constraint/serialization errors
   * surface as the correct HTTP status rather than an opaque 500.
   *
   * Drizzle 0.45+ wraps driver errors in `DrizzleQueryError` and puts
   * the PG error on `.cause`, so we read `(err.cause ?? err).code`.
   *
   * Mappings:
   * - 23505 (unique_violation) → 409 `conflict`
   * - 23514 (check_violation), 23503 (fk_violation) → 400 `validation`
   * - 40P01 (deadlock_detected), 40001 (serialization_failure) → 409 `conflict`
   */
  private async withPgErrorMapping<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err: unknown) {
      if (
        err instanceof ApiHttpException ||
        !(err instanceof Error)
      ) {
        throw err;
      }
      // Drizzle 0.45+ wraps the PG error in .cause
      const inner = (err as { cause?: unknown }).cause;
      const pgSource = (inner instanceof Error ? inner : err) as { code?: string; constraint?: string };
      const pgCode = pgSource.code;
      if (pgCode === '23505') {
        this.logger.warn(
          { constraint: pgSource.constraint },
          'CMS unique violation mapped to 409',
        );
        throw new ApiHttpException({
          status: 409,
          code: 'conflict',
          message: 'A conflicting record already exists',
        });
      }
      // Map check_violation (23514) and foreign_key_violation (23503) to 400
      if (pgCode === '23514' || pgCode === '23503') {
        this.logger.warn(
          { constraint: pgSource.constraint, pgCode },
          'CMS constraint violation mapped to 400',
        );
        throw new ApiHttpException({
          status: 400,
          code: 'validation',
          message: 'A database constraint was violated',
        });
      }
      // Map deadlock_detected (40P01) and serialization_failure (40001) to 409
      if (pgCode === '40P01' || pgCode === '40001') {
        this.logger.warn(
          { pgCode },
          'CMS serialization/deadlock mapped to 409',
        );
        throw new ApiHttpException({
          status: 409,
          code: 'conflict',
          message: 'A concurrent operation conflicted; please retry',
        });
      }
      throw err;
    }
  }
}
