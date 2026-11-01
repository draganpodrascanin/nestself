/**
 * QuestionnaireService: the versioned instrument (spec SUR-01, CFG-03).
 *
 * Versions are platform data owned by NestSelf. A draft or in-review version
 * may be edited; a published version is immutable (editing means a new
 * version); a version used by any cycle is never changed; archiving only
 * stops new launches from picking it. Publication is a separate action
 * (`listening.templates.publish`) and is audited.
 */
import { Injectable } from '@nestjs/common';
import type {
  Principal,
  QuestionnaireDraftRequest,
  QuestionnaireListResponse,
  QuestionnaireVersionResponse,
} from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { AuditWriter } from '../audit/audit-writer.js';
import { ApiHttpException } from '../common/api-error.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService } from '../db/db.service.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ListeningRepository, type QuestionnaireRow } from './listening.repository.js';

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Questionnaire version not found' });
}

function conflict(message: string, details?: Record<string, unknown>): ApiHttpException {
  return new ApiHttpException({ status: 409, code: 'conflict', message, details });
}

export function toQuestionnaireResponse(row: QuestionnaireRow): QuestionnaireVersionResponse {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    dimensions: row.dimensions as QuestionnaireVersionResponse['dimensions'],
    notice: row.notice,
    comparableWithVersionId: row.comparableWithVersionId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class QuestionnaireService {
  constructor(
    private readonly dbs: DbService,
    private readonly repo: ListeningRepository,
    private readonly audit: AuditWriter,
  ) {}

  async list(): Promise<QuestionnaireListResponse> {
    const rows = await this.repo.listQuestionnaires();
    return { items: rows.map(toQuestionnaireResponse) };
  }

  async get(id: string): Promise<QuestionnaireVersionResponse> {
    const row = await this.repo.findQuestionnaire(id);
    if (!row) throw notFound();
    return toQuestionnaireResponse(row);
  }

  async createDraft(body: QuestionnaireDraftRequest, actor: Principal): Promise<QuestionnaireVersionResponse> {
    await this.assertComparableTarget(body.comparableWithVersionId);
    const row = await this.dbs.withTransaction(async (tx) => {
      const version = (await this.repo.maxQuestionnaireVersion(tx)) + 1;
      const created = await this.repo.insertQuestionnaire(
        {
          version,
          status: 'draft',
          dimensions: body.dimensions,
          notice: body.notice,
          comparableWithVersionId: body.comparableWithVersionId,
          createdByUserId: actor.userId,
        },
        tx,
      );
      await this.audit.record(
        {
          action: 'listening.questionnaire.created',
          actorUserId: actor.userId,
          actorKind: 'USER',
          recordType: 'questionnaire_version',
          recordId: created.id,
          result: 'ALLOWED',
          details: { version, comparableWithVersionId: body.comparableWithVersionId },
        },
        { tx },
      );
      return created;
    });
    return toQuestionnaireResponse(row);
  }

  /** Edits a draft or in-review version in place; a published or archived one is immutable. */
  async updateDraft(id: string, body: QuestionnaireDraftRequest, actor: Principal): Promise<QuestionnaireVersionResponse> {
    const existing = await this.repo.findQuestionnaire(id);
    if (!existing) throw notFound();
    if (existing.status !== 'draft' && existing.status !== 'in_review') {
      throw conflict('A published or archived version cannot be edited; create a new version', { status: existing.status });
    }
    if (body.comparableWithVersionId === id) throw conflict('A version cannot be comparable with itself');
    await this.assertComparableTarget(body.comparableWithVersionId);
    const row = await this.dbs.withTransaction(async (tx) => {
      const updated = await this.repo.updateQuestionnaire(
        id,
        {
          dimensions: body.dimensions,
          notice: body.notice,
          comparableWithVersionId: body.comparableWithVersionId,
          // An edited in-review version returns to draft: the review covered other wording.
          status: 'draft',
        },
        tx,
      );
      if (!updated) throw notFound();
      await this.audit.record(
        {
          action: 'listening.questionnaire.updated',
          actorUserId: actor.userId,
          actorKind: 'USER',
          recordType: 'questionnaire_version',
          recordId: id,
          result: 'ALLOWED',
          details: { version: updated.version },
        },
        { tx },
      );
      return updated;
    });
    return toQuestionnaireResponse(row);
  }

  async submitReview(id: string, actor: Principal): Promise<QuestionnaireVersionResponse> {
    return this.transition(id, actor, ['draft'], 'in_review', 'listening.questionnaire.submitted');
  }

  async publish(id: string, actor: Principal): Promise<QuestionnaireVersionResponse> {
    return this.transition(id, actor, ['draft', 'in_review'], 'published', 'listening.questionnaire.published', {
      publishedAt: new Date(),
      publishedByUserId: actor.userId,
    });
  }

  async archive(id: string, actor: Principal): Promise<QuestionnaireVersionResponse> {
    return this.transition(id, actor, ['draft', 'in_review', 'published'], 'archived', 'listening.questionnaire.archived', {
      archivedAt: new Date(),
    });
  }

  private async transition(
    id: string,
    actor: Principal,
    from: QuestionnaireRow['status'][],
    to: QuestionnaireRow['status'],
    action: 'listening.questionnaire.submitted' | 'listening.questionnaire.published' | 'listening.questionnaire.archived',
    extra: Partial<QuestionnaireRow> = {},
  ): Promise<QuestionnaireVersionResponse> {
    const existing = await this.repo.findQuestionnaire(id);
    if (!existing) throw notFound();
    if (!from.includes(existing.status)) {
      throw conflict(`A ${existing.status} version cannot become ${to}`, { status: existing.status });
    }
    const row = await this.dbs.withTransaction(async (tx) => {
      const updated = await this.repo.updateQuestionnaire(id, { status: to, ...extra }, tx);
      if (!updated) throw notFound();
      await this.audit.record(
        {
          action,
          actorUserId: actor.userId,
          actorKind: 'USER',
          recordType: 'questionnaire_version',
          recordId: id,
          result: 'ALLOWED',
          details: { version: updated.version, from: existing.status, to },
        },
        { tx },
      );
      return updated;
    });
    return toQuestionnaireResponse(row);
  }

  private async assertComparableTarget(id: string | null): Promise<void> {
    if (!id) return;
    const target = await this.repo.findQuestionnaire(id);
    if (!target) {
      throw new ApiHttpException({
        status: 400,
        code: 'validation',
        message: 'comparableWithVersionId names an unknown version',
        details: { field: 'comparableWithVersionId' },
      });
    }
  }
}
