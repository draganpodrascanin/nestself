/**
 * QuestionnaireService unit tests (spec SUR-01): numbering, immutability of
 * published versions, the state machine and the audit rows.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Principal, QuestionnaireDraftRequest } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import { PILOT_PRIVACY_NOTICE, PILOT_QUESTIONNAIRE_DIMENSIONS } from './listening-defaults.js';
import type { QuestionnaireRow } from './listening.repository.js';
import { QuestionnaireService } from './questionnaire.service.js';

const NOW = new Date('2026-11-01T10:00:00.000Z');
const actor = { userId: 'user_admin' } as Principal;

const draftBody: QuestionnaireDraftRequest = {
  dimensions: [...PILOT_QUESTIONNAIRE_DIMENSIONS],
  notice: PILOT_PRIVACY_NOTICE,
  comparableWithVersionId: null,
};

function version(overrides: Partial<QuestionnaireRow> = {}): QuestionnaireRow {
  return {
    id: 'q1',
    version: 1,
    status: 'draft',
    dimensions: [...PILOT_QUESTIONNAIRE_DIMENSIONS],
    notice: PILOT_PRIVACY_NOTICE,
    comparableWithVersionId: null,
    createdByUserId: 'user_admin',
    publishedByUserId: null,
    publishedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setup(existing: QuestionnaireRow | null, maxVersion = 1) {
  const tx = { tag: 'tx' };
  const repo = {
    listQuestionnaires: vi.fn().mockResolvedValue(existing ? [existing] : []),
    findQuestionnaire: vi.fn().mockResolvedValue(existing),
    maxQuestionnaireVersion: vi.fn().mockResolvedValue(maxVersion),
    insertQuestionnaire: vi.fn(async (values: Partial<QuestionnaireRow>) => version({ ...values, id: 'q_new' })),
    updateQuestionnaire: vi.fn(async (_id: string, patch: Partial<QuestionnaireRow>) => version({ ...(existing ?? {}), ...patch })),
  };
  const dbs = { withTransaction: vi.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new QuestionnaireService(dbs as never, repo as never, audit as never);
  return { service, repo, audit, tx };
}

describe('QuestionnaireService', () => {
  it('numbers a new draft after the highest existing version and audits it', async () => {
    const { service, repo, audit } = setup(null, 3);
    const created = await service.createDraft(draftBody, actor);
    expect(repo.insertQuestionnaire).toHaveBeenCalledWith(expect.objectContaining({ version: 4, status: 'draft', createdByUserId: 'user_admin' }), expect.anything());
    expect(created.version).toBe(4);
    expect(created.status).toBe('draft');
    expect(created.dimensions).toHaveLength(5);
    expect(audit.record.mock.calls[0]![0]).toMatchObject({ action: 'listening.questionnaire.created', recordId: 'q_new' });
  });

  it('refuses to edit a published version (immutability, spec SUR-01)', async () => {
    const { service, repo } = setup(version({ status: 'published', publishedAt: NOW }));
    const err = await service.updateDraft('q1', draftBody, actor).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiHttpException);
    expect((err as ApiHttpException).getStatus()).toBe(409);
    expect((err as ApiHttpException).code).toBe('conflict');
    expect(repo.updateQuestionnaire).not.toHaveBeenCalled();
  });

  it('an edited in-review version returns to draft', async () => {
    const { service } = setup(version({ status: 'in_review' }));
    const updated = await service.updateDraft('q1', draftBody, actor);
    expect(updated.status).toBe('draft');
  });

  it('publishes from draft or in review with a timestamp and the publisher, once', async () => {
    const { service, repo, audit } = setup(version({ status: 'in_review' }));
    const published = await service.publish('q1', actor);
    expect(published.status).toBe('published');
    expect(repo.updateQuestionnaire).toHaveBeenCalledWith('q1', expect.objectContaining({ status: 'published', publishedByUserId: 'user_admin' }), expect.anything());
    expect(audit.record.mock.calls[0]![0]).toMatchObject({ action: 'listening.questionnaire.published', details: { version: 1, from: 'in_review', to: 'published' } });

    const again = setup(version({ status: 'published' }));
    const err = await again.service.publish('q1', actor).catch((e: unknown) => e);
    expect((err as ApiHttpException).code).toBe('conflict');
  });

  it('archives a published version and refuses to archive twice', async () => {
    const { service } = setup(version({ status: 'published' }));
    expect((await service.archive('q1', actor)).status).toBe('archived');
    const archived = setup(version({ status: 'archived' }));
    await expect(archived.service.archive('q1', actor)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('refuses a comparable target that does not exist and a self reference', async () => {
    const { service, repo } = setup(version());
    repo.findQuestionnaire.mockImplementation(async (id: string) => (id === 'q1' ? version() : null));
    await expect(service.updateDraft('q1', { ...draftBody, comparableWithVersionId: 'q_missing' }, actor)).rejects.toMatchObject({ code: 'validation' });
    await expect(service.updateDraft('q1', { ...draftBody, comparableWithVersionId: 'q1' }, actor)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('404s an unknown version', async () => {
    const { service } = setup(null);
    await expect(service.get('q_missing')).rejects.toMatchObject({ status: 404 });
  });
});
