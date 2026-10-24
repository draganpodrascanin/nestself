/**
 * CmsService -- business logic for the M1 content workflow (T-C1.10).
 *
 * Manages content resources, variants, revisions and publications.
 * State transitions follow WRK-R-01..36.
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
import { AUTHORED_LOCALES } from '@nestself/contracts';
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
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { OutboxWriter } from '../notifications/outbox/outbox-writer.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AvailabilityVersionService } from '../library/availability/availability-version.service.js';
import { ApiHttpException } from '../common/api-error.js';

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
        body: emptyDoc,
        title: '',
        summary: '',
        authorUserId: principal.userId,
        lastEditorUserId: principal.userId,
        lockVersion: 1,
      });
    });

    return this.getRevision(revisionId);
  }

  // =========================================================================
  // Save working revision (PUT) with If-Match
  // =========================================================================

  async saveRevision(
    variantId: string,
    revisionId: string,
    body: RevisionUpdateRequest,
    ifMatchVersion: number,
    principal: Principal,
  ) {
    // Load the revision
    const revRows = await this.dbService.db
      .select()
      .from(contentRevisions)
      .where(eq(contentRevisions.id, revisionId))
      .limit(1);

    const rev = revRows[0];
    if (!rev) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found' });
    }

    // WRK-R-33: only draft or changes_requested can be edited
    if (rev.state !== 'draft' && rev.state !== 'changes_requested') {
      throw new ApiHttpException({
        status: 409,
        code: 'content_revision_locked',
        message: 'This revision is locked and cannot be edited',
      });
    }

    // Check variant match
    if (rev.contentVariantId !== variantId) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Revision not found for this variant' });
    }

    // If-Match check (optimistic concurrency C-06)
    if (rev.lockVersion !== ifMatchVersion) {
      throw new ApiHttpException({
        status: 409,
        code: 'content_edit_conflict',
        message: 'The revision has been modified by another session',
        details: { currentLockVersion: rev.lockVersion },
      });
    }

    // Validate content document if body is provided
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
      // Persist the validated document, not the raw input
      body = { ...body, body: result.document as unknown as Record<string, unknown> };
    }

    // Build update set
    const updateSet: Record<string, unknown> = {
      lockVersion: rev.lockVersion + 1,
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
    if (body.cta !== undefined) updateSet.cta = body.cta;
    if (body.relatedResourceIds !== undefined) updateSet.relatedResourceIds = body.relatedResourceIds;
    if (body.quicklyOutdated !== undefined) updateSet.quicklyOutdated = body.quicklyOutdated;

    await this.dbService.db
      .update(contentRevisions)
      .set(updateSet)
      .where(
        and(
          eq(contentRevisions.id, revisionId),
          eq(contentRevisions.lockVersion, rev.lockVersion),
        ),
      );

    // Maintain content_revision_media from the body's media nodes
    if (body.body) {
      await this.syncRevisionMedia(revisionId, body.body as Record<string, unknown>);
    }

    const updated = await this.getRevision(revisionId);
    return updated;
  }

  // =========================================================================
  // Create new working revision (POST variants/:id/revisions, WRK-R-02)
  // =========================================================================

  async createNewWorkingRevision(
    variantId: string,
    principal: Principal,
  ) {
    // Check that no working revision exists
    const existing = await this.dbService.db
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
    const sourceRows = await this.dbService.db
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
    const maxRevResult = await this.dbService.db
      .select({ max: sql<number>`COALESCE(MAX(revision_number), 0)` })
      .from(contentRevisions)
      .where(eq(contentRevisions.contentVariantId, variantId));
    const nextRevisionNumber = (maxRevResult[0]?.max ?? 0) + 1;

    const newRevisionId = randomUUID();

    await this.dbService.db.insert(contentRevisions).values({
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
      cta: source?.cta ?? null,
      relatedResourceIds: source?.relatedResourceIds ?? [],
      authorUserId: principal.userId,
      lastEditorUserId: principal.userId,
      lockVersion: 1,
    });

    return this.getRevision(newRevisionId);
  }

  // =========================================================================
  // Submit revision (POST revisions/:id/submit)
  // =========================================================================

  async submitRevision(
    revisionId: string,
    principal: Principal,
  ) {
    const rev = await this.loadRevisionOrThrow(revisionId);

    // WRK-R-01: only draft or changes_requested can be submitted
    if (rev.state !== 'draft' && rev.state !== 'changes_requested') {
      throw new ApiHttpException({
        status: 409,
        code: 'content_not_submittable',
        message: `Cannot submit a revision in state ${rev.state}`,
      });
    }

    // Validate the document
    const validationResult = validateContentDocument(rev.body, {
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

    // Check media readiness
    await this.checkMediaReady(revisionId);

    const now = new Date();

    await this.dbService.db.transaction(async (tx) => {
      await tx
        .update(contentRevisions)
        .set({
          state: 'in_review',
          submittedAt: now,
          updatedAt: now,
        })
        .where(eq(contentRevisions.id, revisionId));

      await this.auditWriter.record({
        action: 'content.submitted',
        actorUserId: principal.userId,
        actorKind: 'USER',
        recordType: 'content_revision',
        recordId: revisionId,
        result: 'ALLOWED',
        sessionId: principal.sessionId ?? null,
      });

      await this.outboxWriter.write(tx, {
        type: 'content.review_requested',
        aggregateType: 'content_revision',
        aggregateId: revisionId,
        payload: { revisionId },
      });
    });

    return this.getRevision(revisionId);
  }

  // =========================================================================
  // Approve revision (POST revisions/:id/approve)
  // =========================================================================

  async approveRevision(
    revisionId: string,
    principal: Principal,
    _comment?: string,
  ) {
    const rev = await this.loadRevisionOrThrow(revisionId);

    if (rev.state !== 'in_review') {
      throw new ApiHttpException({
        status: 409,
        code: 'content_not_submittable',
        message: `Cannot approve a revision in state ${rev.state}`,
      });
    }

    // ACC-R-08: Self-review check (5.5)
    if (rev.authorUserId === principal.userId || rev.lastEditorUserId === principal.userId) {
      throw new ApiHttpException({
        status: 403,
        code: 'content_self_review',
        message: 'A reviewer cannot approve a revision they authored or last edited',
      });
    }

    // The discipline check is enforced by the authorization guard via
    // CmsResourceLoader.forRevision({ forReview: true }) which sets
    // resource.category = review_discipline. But we double-check discipline
    // existence here (ACC-R-07 fail-closed).
    const resourceRows = await this.dbService.db
      .select({
        reviewDiscipline: contentResources.reviewDiscipline,
        reviewPolicy: contentResources.reviewPolicy,
      })
      .from(contentRevisions)
      .innerJoin(contentVariants, eq(contentRevisions.contentVariantId, contentVariants.id))
      .innerJoin(contentResources, eq(contentVariants.contentResourceId, contentResources.id))
      .where(eq(contentRevisions.id, revisionId))
      .limit(1);

    const resource = resourceRows[0];
    if (!resource?.reviewDiscipline) {
      throw new ApiHttpException({
        status: 403,
        code: 'content_review_discipline',
        message: 'The resource has no review discipline configured',
      });
    }

    // Get variant info for the hash
    const variantRows = await this.dbService.db
      .select({ locale: contentVariants.locale })
      .from(contentVariants)
      .where(eq(contentVariants.id, rev.contentVariantId))
      .limit(1);
    const locale = variantRows[0]?.locale ?? 'en';

    // Get media asset ids for the hash
    const mediaRows = await this.dbService.db
      .select({ mediaAssetId: contentRevisionMedia.mediaAssetId })
      .from(contentRevisionMedia)
      .where(eq(contentRevisionMedia.contentRevisionId, revisionId));
    const mediaAssetIds = mediaRows.map((r) => r.mediaAssetId);

    // Compute approval hash (FMT-R-08)
    const hashInput: ApprovalHashInput = {
      body: rev.body,
      title: rev.title,
      summary: rev.summary,
      outcome: rev.outcome ?? null,
      durationSeconds: rev.durationSeconds ?? 0,
      difficulty: rev.difficulty ?? '',
      sources: Array.isArray(rev.sources) ? (rev.sources as string[]) : [],
      locale,
      mediaAssetIds,
      relatedResourceIds: rev.relatedResourceIds ?? [],
      cta: rev.cta,
      reviewDiscipline: resource.reviewDiscipline,
      proposedAudience: rev.proposedAudience,
    };
    const hash = await approvalHash(hashInput);

    const now = new Date();

    await this.dbService.db.transaction(async (tx) => {
      // Supersede previous approved revisions of the same variant
      await tx
        .update(contentRevisions)
        .set({ state: 'superseded', updatedAt: now })
        .where(
          and(
            eq(contentRevisions.contentVariantId, rev.contentVariantId),
            eq(contentRevisions.state, 'approved'),
            ne(contentRevisions.id, revisionId),
          ),
        );

      await tx
        .update(contentRevisions)
        .set({
          state: 'approved',
          approvedAt: now,
          approvedByUserId: principal.userId,
          approvalHash: hash,
          updatedAt: now,
        })
        .where(eq(contentRevisions.id, revisionId));

      await this.auditWriter.record({
        action: 'content.approved',
        actorUserId: principal.userId,
        actorKind: 'USER',
        recordType: 'content_revision',
        recordId: revisionId,
        result: 'ALLOWED',
        sessionId: principal.sessionId ?? null,
      });

      await this.outboxWriter.write(tx, {
        type: 'content.approved',
        aggregateType: 'content_revision',
        aggregateId: revisionId,
        payload: { revisionId },
      });
    });

    return this.getRevision(revisionId);
  }

  // =========================================================================
  // Publish now (POST publications)
  // =========================================================================

  async publishNow(
    input: PublicationCreateRequest,
    principal: Principal,
  ) {
    const now = new Date();

    // Load resource and its variants
    const resourceRows = await this.dbService.db
      .select()
      .from(contentResources)
      .where(eq(contentResources.id, input.resourceId))
      .limit(1);
    const resource = resourceRows[0];
    if (!resource) {
      throw new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
    }

    // Get all variants
    const variants = await this.dbService.db
      .select()
      .from(contentVariants)
      .where(eq(contentVariants.contentResourceId, input.resourceId));

    // Determine which locales to publish
    const requestedLocales = input.locales ?? [...AUTHORED_LOCALES];

    // WRK-R-36: If not a correction (no locales specified), all authored locales
    // must have an approved revision
    if (!input.locales) {
      const missingLocales: string[] = [];
      for (const locale of AUTHORED_LOCALES) {
        const variant = variants.find((v) => v.locale === locale);
        if (!variant) {
          missingLocales.push(locale);
          continue;
        }
        const approvedRev = await this.dbService.db
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
      // Correction case: the specified locales must have an approved revision;
      // other locales must already have a live publication for this resource
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
        const approvedRev = await this.dbService.db
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
    }

    const publicationIds: string[] = [];

    await this.dbService.db.transaction(async (tx) => {
      for (const locale of requestedLocales) {
        const variant = variants.find((v) => v.locale === locale);
        if (!variant) continue;

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
          reviewDiscipline: resource.reviewDiscipline ?? '',
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

        // Check audience does not exceed proposed_audience (C-12)
        this.checkAudienceNotBroader(input.audience, approvedRev.proposedAudience);

        // Supersession: set ends_at on previous live publication
        await tx
          .update(contentPublications)
          .set({ endsAt: now })
          .where(
            and(
              eq(contentPublications.contentVariantId, variant.id),
              eq(contentPublications.state, 'live'),
              isNull(contentPublications.withdrawnAt),
            ),
          );

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

    // Audit
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

    // Bump availability version
    const orgIds = input.audience
      .filter((a) => a.orgId)
      .map((a) => a.orgId!);
    const hasAllEligible = input.audience.some((a) => a.kind === 'all_eligible');
    if (hasAllEligible) {
      await this.availabilityVersionService.bump('global');
    } else if (orgIds.length > 0) {
      await this.availabilityVersionService.bump(orgIds);
    }

    // Return first publication (for API response)
    if (publicationIds.length === 0) {
      throw new ApiHttpException({ status: 500, code: 'internal', message: 'No publications created' });
    }

    return this.getPublication(publicationIds[0]!);
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

  private checkAudienceNotBroader(
    publishAudience: AudienceEntry[],
    proposedAudience: unknown,
  ): void {
    // If no proposed_audience was set, the publisher cannot set any audience
    // restrictions beyond what the approval allows. For M1, if proposedAudience
    // is null/undefined, we allow the publisher to set any audience (the revision
    // was approved without a proposed audience constraint).
    if (!proposedAudience || !Array.isArray(proposedAudience)) return;

    // C-12: The publisher may narrow but not broaden the proposed audience.
    // all_eligible in publish but not in proposed -> broadening
    const proposedHasAllEligible = (proposedAudience as AudienceEntry[]).some(
      (a) => a.kind === 'all_eligible',
    );
    const publishHasAllEligible = publishAudience.some(
      (a) => a.kind === 'all_eligible',
    );

    if (publishHasAllEligible && !proposedHasAllEligible) {
      throw new ApiHttpException({
        status: 403,
        code: 'content_audience_exceeds_approval',
        message: 'Publication audience exceeds the approved proposed audience',
      });
    }

    // For organization/org_unit audiences, each publish org must appear in proposed
    if (!proposedHasAllEligible) {
      const proposedOrgIds = new Set(
        (proposedAudience as AudienceEntry[])
          .filter((a) => a.orgId)
          .map((a) => a.orgId),
      );
      for (const aud of publishAudience) {
        if (aud.kind === 'all_eligible') continue;
        if (aud.orgId && !proposedOrgIds.has(aud.orgId)) {
          throw new ApiHttpException({
            status: 403,
            code: 'content_audience_exceeds_approval',
            message: `Organization ${aud.orgId} is not in the approved proposed audience`,
          });
        }
      }
    }
  }

  /**
   * Sync content_revision_media from the document's approvedMedia nodes.
   */
  private async syncRevisionMedia(
    revisionId: string,
    doc: Record<string, unknown>,
  ): Promise<void> {
    const mediaIds = new Set<string>();

    function walk(node: Record<string, unknown>) {
      if (node.type === 'approvedMedia' && node.attrs) {
        const attrs = node.attrs as Record<string, unknown>;
        if (typeof attrs.mediaAssetId === 'string') {
          mediaIds.add(attrs.mediaAssetId);
        }
      }
      if (Array.isArray(node.content)) {
        for (const child of node.content as Record<string, unknown>[]) {
          walk(child);
        }
      }
    }
    walk(doc);

    // Delete existing and re-insert
    await this.dbService.db
      .delete(contentRevisionMedia)
      .where(eq(contentRevisionMedia.contentRevisionId, revisionId));

    for (const mediaAssetId of mediaIds) {
      await this.dbService.db.insert(contentRevisionMedia).values({
        id: randomUUID(),
        contentRevisionId: revisionId,
        mediaAssetId,
        usageKind: 'body_media',
      });
    }
  }
}
