/**
 * Follow-up approval policy mapping (D-CW-37): storage is UPPER_CASE, the
 * contract lower case, and an unknown stored value never reads as automatic.
 */
import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_APPROVAL_POLICIES } from '@nestself/contracts';
import { FollowUpPolicyReader, toContractFollowUpPolicy, toDbFollowUpPolicy } from './follow-up-policy.js';

function readerReturning(rows: { policy: string }[]) {
  const query = { from: () => query, where: async () => rows };
  const db = { select: () => query };
  return new FollowUpPolicyReader({ db } as never);
}

describe('follow-up policy mapping', () => {
  it('maps both stored values to the contract and back', () => {
    expect(toContractFollowUpPolicy('AUTOMATIC')).toBe('automatic');
    expect(toContractFollowUpPolicy('MANAGER_APPROVAL')).toBe('manager_approval');
    for (const policy of FOLLOW_UP_APPROVAL_POLICIES) {
      expect(toContractFollowUpPolicy(toDbFollowUpPolicy(policy))).toBe(policy);
    }
  });

  it('throws on an unknown or lower-case stored value instead of falling back', () => {
    for (const stored of ['automatic', 'NONE', '', 'toString']) {
      expect(() => toContractFollowUpPolicy(stored), stored).toThrow();
    }
  });
});

describe('FollowUpPolicyReader', () => {
  it('reads the organization’s policy in the contract spelling', async () => {
    await expect(readerReturning([{ policy: 'MANAGER_APPROVAL' }]).policyOf('org_1')).resolves.toBe('manager_approval');
  });

  it('throws for a missing organization', async () => {
    await expect(readerReturning([]).policyOf('org_missing')).rejects.toThrow();
  });
});
