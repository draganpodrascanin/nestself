/**
 * The stored audit row never carries the raw session id: the id is the value
 * of the HttpOnly session cookie, so a reader of the audit table could replay
 * a live session. The row keeps its hash, the same value the sessions list
 * and `/auth/me` name a session by.
 */
import { describe, expect, it, vi } from 'vitest';
import { hashSessionId } from '../session/session-helpers.js';
import { AuditWriter, type AuditEventInput } from './audit-writer.js';

const EVENT: AuditEventInput = {
  action: 'user.updated',
  actorUserId: 'user_ivana',
  actorKind: 'USER',
  recordType: 'user',
  recordId: 'user_ivana',
  result: 'ALLOWED',
  details: { fields: ['displayName'] },
};

function setup() {
  const repo = {
    insertEvent: vi.fn().mockResolvedValue(undefined),
    findRetentionPolicies: vi.fn().mockResolvedValue([]),
  };
  const writer = new AuditWriter(repo as never);
  writer.strictMode = true;
  return { repo, writer };
}

describe('AuditWriter session id', () => {
  it('stores the hash of the session id, never the cookie value', async () => {
    const { repo, writer } = setup();

    await writer.record({ ...EVENT, sessionId: 'raw-cookie-value' });

    const row = repo.insertEvent.mock.calls[0]![0] as { sessionId: string | null };
    expect(row.sessionId).toBe(hashSessionId('raw-cookie-value'));
    expect(JSON.stringify(row)).not.toContain('raw-cookie-value');
  });

  it('keeps null for a bearer or system actor without a session', async () => {
    const { repo, writer } = setup();

    await writer.record(EVENT);
    await writer.record({ ...EVENT, sessionId: null });

    for (const call of repo.insertEvent.mock.calls) {
      expect((call[0] as { sessionId: string | null }).sessionId).toBeNull();
    }
  });

  it('hashes inside a transaction too', async () => {
    const { repo, writer } = setup();
    const tx = { kind: 'tx' };

    await writer.record({ ...EVENT, sessionId: 'raw-cookie-value' }, { tx: tx as never });

    expect(repo.insertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: hashSessionId('raw-cookie-value') }),
      tx,
    );
  });
});
