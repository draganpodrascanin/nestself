import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { ActiveContext } from '@nestself/contracts';
import { createApiClient } from './client';
import { createCmsApi, computeContentDigest } from './cms';
import { cmsKeys, mediaKeys } from './query-keys';

// ---------------------------------------------------------------------------
// Mock fetch recorder
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function recorder(responseBody: unknown, status = 200) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const reqHeaders: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => {
        reqHeaders[k] = v;
      });
    }
    let parsedBody: unknown;
    if (typeof init?.body === 'string') {
      try {
        parsedBody = JSON.parse(init.body);
      } catch {
        parsedBody = init.body;
      }
    } else if (init?.body instanceof FormData) {
      parsedBody = '[FormData]';
    }
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: reqHeaders,
      body: parsedBody,
    });
    return new Response(JSON.stringify(responseBody), {
      status,
      headers: {
        'content-type': 'application/json',
        etag: '"2"',
      },
    });
  };
  const client = createApiClient({ baseUrl: 'http://x', mode: 'cookie', fetchImpl });
  return { client, calls, last: () => calls[calls.length - 1]! };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createCmsApi', () => {
  const originalDocument = globalThis.document;
  beforeEach(() => {
    // Provide a fake document.cookie for CSRF (cookie mode)
    Object.defineProperty(globalThis, 'document', {
      value: { cookie: 'nestself_csrf=tok123' },
      writable: true,
      configurable: true,
    });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      value: originalDocument,
      writable: true,
      configurable: true,
    });
  });

  const RESOURCE_SUMMARY = {
    id: 'res_1',
    type: 'article',
    state: 'active',
    primaryCategoryId: 'cat_stress',
    ownerUserId: 'user_1',
    reviewPolicy: 'professional',
    reviewDiscipline: 'psychological',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  const RESOURCE_DETAIL = {
    ...RESOURCE_SUMMARY,
    variants: [],
  };

  const REVISION = {
    id: 'rev_1',
    contentVariantId: 'var_1',
    revisionNumber: 1,
    state: 'draft',
    body: { type: 'doc', schemaVersion: 1, content: [] },
    title: 'Test',
    summary: 'Summary',
    outcome: null,
    durationSeconds: null,
    durationBand: null,
    difficulty: null,
    sources: null,
    proposedAudience: null,
    cta: null,
    relatedResourceIds: null,
    authorUserId: 'user_1',
    lastEditorUserId: 'user_1',
    lockVersion: 2,
    approvalHash: null,
    submittedAt: null,
    approvedAt: null,
    approvedByUserId: null,
    reviewDueAt: null,
    quicklyOutdated: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };

  it('listResources sends GET with query params', async () => {
    const { client, last } = recorder({ items: [RESOURCE_SUMMARY], nextCursor: null });
    const api = createCmsApi(client);
    await api.listResources({ categoryId: 'cat_stress', limit: 10 });
    expect(last().url).toBe('http://x/api/ops/cms/resources?categoryId=cat_stress&limit=10');
    expect(last().method).toBe('GET');
  });

  it('getResource sends GET for resource detail', async () => {
    const { client, last } = recorder(RESOURCE_DETAIL);
    const api = createCmsApi(client);
    await api.getResource('res_1');
    expect(last().url).toBe('http://x/api/ops/cms/resources/res_1');
    expect(last().method).toBe('GET');
  });

  it('createResource sends POST with body', async () => {
    const { client, last } = recorder(RESOURCE_DETAIL, 201);
    const api = createCmsApi(client);
    await api.createResource({
      type: 'article',
      primaryCategoryId: 'cat_stress',
      reviewPolicy: 'professional',
      reviewDiscipline: 'psychological',
      locale: 'en',
      title: 'Test Article',
    });
    expect(last().method).toBe('POST');
    expect(last().url).toBe('http://x/api/ops/cms/resources');
    expect(last().body).toEqual(expect.objectContaining({ type: 'article', title: 'Test Article' }));
  });

  it('saveRevision sends PUT with If-Match header', async () => {
    const { client, last } = recorder(REVISION);
    const api = createCmsApi(client);
    const result = await api.saveRevision('var_1', 'rev_1', { title: 'Updated' }, 1);
    expect(last().method).toBe('PUT');
    expect(last().url).toBe('http://x/api/ops/cms/variants/var_1/revisions/rev_1');
    expect(last().headers['if-match']).toBe('"1"');
    expect(result.lockVersion).toBe(2);
  });

  it('submitRevision sends POST', async () => {
    const { client, last } = recorder(REVISION);
    const api = createCmsApi(client);
    await api.submitRevision('rev_1');
    expect(last().method).toBe('POST');
    expect(last().url).toBe('http://x/api/ops/cms/revisions/rev_1/submit');
  });

  it('approveRevision sends POST', async () => {
    const { client, last } = recorder(REVISION);
    const api = createCmsApi(client);
    await api.approveRevision('rev_1');
    expect(last().method).toBe('POST');
    expect(last().url).toBe('http://x/api/ops/cms/revisions/rev_1/approve');
  });

  it('addVariant sends POST with locale', async () => {
    const { client, last } = recorder(REVISION, 201);
    const api = createCmsApi(client);
    await api.addVariant('res_1', 'hu');
    expect(last().method).toBe('POST');
    expect(last().url).toBe('http://x/api/ops/cms/resources/res_1/variants');
    expect(last().body).toEqual({ locale: 'hu' });
  });

  it('publishNow sends POST with Idempotency-Key', async () => {
    const { client, last } = recorder({}, 201);
    const api = createCmsApi(client);
    await api.publishNow({
      resourceId: 'res_1',
      audience: [{ kind: 'all_eligible', includeDescendants: true }],
    });
    expect(last().method).toBe('POST');
    expect(last().url).toBe('http://x/api/ops/cms/publications');
    expect(last().headers['idempotency-key']).toBeTruthy();
  });

  it('getMediaAsset sends GET', async () => {
    const { client, last } = recorder({
      id: 'media_1',
      kind: 'image',
      state: 'ready',
      ownerCategoryId: 'cat_1',
      checksumSha256: null,
      byteSize: 1024,
      mimeType: 'image/jpeg',
      durationSeconds: null,
      width: 800,
      height: 600,
      scanStatus: 'no_threats_found',
      licenseKind: 'owned',
      licenseReference: null,
      rightsExpiresAt: null,
      consentReference: null,
      altText: null,
      focalPoint: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      readyAt: '2026-01-01T00:00:00.000Z',
    });
    const api = createCmsApi(client);
    await api.getMediaAsset('media_1');
    expect(last().url).toBe('http://x/api/ops/cms/media/media_1');
    expect(last().method).toBe('GET');
  });
});

describe('computeContentDigest', () => {
  it('produces RFC 9530 sha-256 format', async () => {
    const blob = new Blob(['hello world'], { type: 'text/plain' });
    const digest = await computeContentDigest(blob);
    expect(digest).toMatch(/^sha-256=:[A-Za-z0-9+/]+=*:$/);
    // SHA-256 of "hello world" is known
    expect(digest).toBe('sha-256=:uU0nuZNNPgilLlLX2n2r+sSE7+N6U4DukIj3rOLvzek=:');
  });

  it('handles empty file', async () => {
    const blob = new Blob([], { type: 'application/octet-stream' });
    const digest = await computeContentDigest(blob);
    expect(digest).toMatch(/^sha-256=:[A-Za-z0-9+/]+=*:$/);
  });
});

describe('cmsKeys (extended)', () => {
  const ctx: ActiveContext = { kind: 'operations' };

  it('resources key', () => {
    expect(cmsKeys.resources(ctx)).toEqual(['ctx', 'operations', 'cms', 'resources']);
  });

  it('resourceList key includes params', () => {
    const params = { categoryId: 'cat_stress' };
    const key = cmsKeys.resourceList(ctx, params);
    expect(key).toEqual(['ctx', 'operations', 'cms', 'resources', 'list', params]);
  });

  it('resourceDetail key includes id', () => {
    expect(cmsKeys.resourceDetail(ctx, 'res_1')).toEqual([
      'ctx', 'operations', 'cms', 'resources', 'res_1',
    ]);
  });
});

describe('mediaKeys (extended)', () => {
  const ctx: ActiveContext = { kind: 'operations' };

  it('detail key includes assetId', () => {
    expect(mediaKeys.detail(ctx, 'asset_1')).toEqual([
      'ctx', 'operations', 'media', 'asset_1',
    ]);
  });
});
