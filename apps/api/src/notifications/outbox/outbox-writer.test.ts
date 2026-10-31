/**
 * OutboxWriter unit test (T-C1.10).
 */
import { describe, it, expect, vi } from 'vitest';
import { OutboxWriter } from './outbox-writer.js';

describe('OutboxWriter', () => {
  const writer = new OutboxWriter();

  function mockTx() {
    return {
      insert: vi.fn().mockReturnValue({
        values: vi.fn().mockResolvedValue(undefined),
      }),
    } as unknown as Parameters<OutboxWriter['write']>[0];
  }

  it('inserts an outbox event', async () => {
    const tx = mockTx();
    await writer.write(tx, {
      type: 'content.review_requested',
      aggregateType: 'content_revision',
      aggregateId: 'rev_123',
      payload: { revisionId: 'rev_123' },
    });

    expect(tx.insert).toHaveBeenCalledTimes(1);
  });

  it('rejects null payload', async () => {
    const tx = mockTx();
    await expect(
      writer.write(tx, {
        type: 'test',
        aggregateType: 'test',
        aggregateId: 'test',
        payload: null as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow('payload must be a plain object');
  });

  it('rejects array payload', async () => {
    const tx = mockTx();
    await expect(
      writer.write(tx, {
        type: 'test',
        aggregateType: 'test',
        aggregateId: 'test',
        payload: [] as unknown as Record<string, unknown>,
      }),
    ).rejects.toThrow('payload must be a plain object');
  });

  it('passes orgId through when provided', async () => {
    const tx = mockTx();
    await writer.write(tx, {
      type: 'publication.started',
      aggregateType: 'content_publication',
      aggregateId: 'pub_123',
      orgId: 'org_abc',
      payload: { publicationId: 'pub_123' },
    });

    expect(tx.insert).toHaveBeenCalledTimes(1);
  });
});
