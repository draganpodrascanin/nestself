import { describe, it, expect, vi } from 'vitest';
import { AuditWriter, hashIp, parseUserAgentFamily, sanitizeDetails } from './audit-writer.js';
import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function makeRepoMock() {
  return {
    insertEvent: vi.fn().mockResolvedValue(undefined),
    findRetentionPolicies: vi.fn().mockResolvedValue([
      { dataCategory: 'audit_security', minDays: 365 * 3 },
      { dataCategory: 'audit_authorization', minDays: 365 * 10 },
      { dataCategory: 'audit_financial', minDays: 365 * 10 },
      { dataCategory: 'audit_content_access', minDays: 365 },
      { dataCategory: 'audit_admin', minDays: 365 * 10 },
    ]),
  };
}

function makeWriter(repo = makeRepoMock()) {
  const writer = new AuditWriter(repo as never);
  writer.strictMode = true;
  return { writer, repo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AuditWriter', () => {
  describe('record()', () => {
    it('inserts with correct ipHash (SHA-256 truncated to 32 chars)', async () => {
      const { writer, repo } = makeWriter();
      await writer.record({
        action: 'auth.sign_in.succeeded',
        actorUserId: 'u1',
        actorKind: 'USER',
        recordType: 'Session',
        recordId: 's1',
        result: 'ALLOWED',
        ip: '203.0.113.42',
      });

      const row = repo.insertEvent.mock.calls[0]![0];
      const expected = createHash('sha256').update('203.0.113.42').digest('hex').slice(0, 32);
      expect(row.ipHash).toBe(expected);
      expect(row.ipHash).toHaveLength(32);
    });

    it('computes correct userAgentFamily', async () => {
      const { writer, repo } = makeWriter();
      await writer.record({
        action: 'auth.sign_in.succeeded',
        actorUserId: 'u1',
        actorKind: 'USER',
        recordType: 'Session',
        recordId: 's1',
        result: 'ALLOWED',
        userAgent:
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      });

      const row = repo.insertEvent.mock.calls[0]![0];
      expect(row.userAgentFamily).toBe('Chrome 120');
    });

    it('computes correct retainUntil', async () => {
      const { writer, repo } = makeWriter();
      const now = new Date('2026-01-15T12:00:00Z');
      await writer.record({
        action: 'auth.sign_in.succeeded', // SECURITY -> audit_security -> 3 years
        actorUserId: 'u1',
        actorKind: 'USER',
        recordType: 'Session',
        recordId: 's1',
        result: 'ALLOWED',
        occurredAt: now,
      });

      const row = repo.insertEvent.mock.calls[0]![0];
      const retainUntil = row.retainUntil as Date;
      const diffDays = Math.round(
        (retainUntil.getTime() - now.getTime()) / 86_400_000,
      );
      expect(diffDays).toBe(365 * 3);
    });

    it('sanitises details (removes forbidden keys)', async () => {
      const { writer, repo } = makeWriter();
      await writer.record({
        action: 'auth.sign_in.failed',
        actorUserId: null,
        actorKind: 'USER',
        recordType: 'Session',
        recordId: 's1',
        result: 'DENIED',
        details: {
          password: 'hunter2',
          emailNormalised: 'a@b.com',
          email: 'raw@b.com',
          safe: 'keep-me',
        },
      });

      const row = repo.insertEvent.mock.calls[0]![0];
      const details = row.details as Record<string, unknown>;
      expect(details).not.toHaveProperty('password');
      expect(details).not.toHaveProperty('email');
      expect(details).toHaveProperty('emailNormalised', 'a@b.com');
      expect(details).toHaveProperty('safe', 'keep-me');
    });

    it('sanitises new forbidden keys: tokens, conversationBody, professionalNote, emailAddress', async () => {
      const { writer, repo } = makeWriter();
      await writer.record({
        action: 'content.created',
        actorUserId: 'u1',
        actorKind: 'USER',
        recordType: 'Resource',
        recordId: 'r1',
        result: 'ALLOWED',
        details: {
          tokens: { access: 'secret-at', refresh: 'secret-rt' },
          conversationBody: 'private chat message',
          professionalNote: 'clinical note content',
          emailAddress: 'person@example.com',
          safeField: 'visible',
        },
      });

      const row = repo.insertEvent.mock.calls[0]![0];
      const details = row.details as Record<string, unknown>;
      expect(details).not.toHaveProperty('tokens');
      expect(details).not.toHaveProperty('conversationBody');
      expect(details).not.toHaveProperty('professionalNote');
      expect(details).not.toHaveProperty('emailAddress');
      expect(details).toHaveProperty('safeField', 'visible');
    });

    it('does not throw on write failure in non-strict mode', async () => {
      const repo = makeRepoMock();
      repo.insertEvent.mockRejectedValue(new Error('db down'));
      const writer = new AuditWriter(repo as never);
      writer.strictMode = false;

      await expect(
        writer.record({
          action: 'auth.sign_out',
          actorUserId: 'u1',
          actorKind: 'USER',
          recordType: 'Session',
          recordId: 's1',
          result: 'NONE',
        }),
      ).resolves.toBeUndefined();
    });

    it('throws on write failure in strict mode', async () => {
      const repo = makeRepoMock();
      repo.insertEvent.mockRejectedValue(new Error('db down'));
      const { writer } = makeWriter(repo);

      await expect(
        writer.record({
          action: 'auth.sign_out',
          actorUserId: 'u1',
          actorKind: 'USER',
          recordType: 'Session',
          recordId: 's1',
          result: 'NONE',
        }),
      ).rejects.toThrow('db down');
    });

    it('sets ipHash to null when ip is null', async () => {
      const { writer, repo } = makeWriter();
      await writer.record({
        action: 'auth.sign_in.succeeded',
        actorUserId: 'u1',
        actorKind: 'USER',
        recordType: 'Session',
        recordId: 's1',
        result: 'ALLOWED',
        ip: null,
      });
      const row = repo.insertEvent.mock.calls[0]![0];
      expect(row.ipHash).toBeNull();
    });

    it('returns unknown for missing user-agent', async () => {
      const { writer, repo } = makeWriter();
      await writer.record({
        action: 'auth.sign_in.succeeded',
        actorUserId: 'u1',
        actorKind: 'USER',
        recordType: 'Session',
        recordId: 's1',
        result: 'ALLOWED',
      });
      const row = repo.insertEvent.mock.calls[0]![0];
      expect(row.userAgentFamily).toBe('unknown');
    });
  });
});

// ---------------------------------------------------------------------------
// Unit helpers
// ---------------------------------------------------------------------------

describe('hashIp', () => {
  it('returns 32-char hex', () => {
    const h = hashIp('127.0.0.1');
    expect(h).toHaveLength(32);
    expect(h).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('parseUserAgentFamily', () => {
  it('parses Chrome', () => {
    expect(
      parseUserAgentFamily(
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/118.0.0.0 Safari/537.36',
      ),
    ).toBe('Chrome 118');
  });

  it('returns unknown for null', () => {
    expect(parseUserAgentFamily(null)).toBe('unknown');
  });
});

describe('sanitizeDetails', () => {
  it('removes forbidden keys recursively', () => {
    const result = sanitizeDetails({
      token: 'abc',
      nested: { secret: 'x', safe: 1 },
    });
    expect(result).toEqual({ nested: { safe: 1 } });
  });

  it('truncates strings over 500 characters', () => {
    const longStr = 'a'.repeat(600);
    const result = sanitizeDetails({ info: longStr });
    expect((result.info as string).length).toBe(500);
  });

  it('keeps emailNormalised but drops email', () => {
    const result = sanitizeDetails({
      email: 'raw@example.com',
      emailNormalised: 'norm@example.com',
    });
    expect(result).not.toHaveProperty('email');
    expect(result).toHaveProperty('emailNormalised', 'norm@example.com');
  });
});
