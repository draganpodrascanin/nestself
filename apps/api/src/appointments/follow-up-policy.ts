/**
 * The organization's follow-up approval policy (D-CW-37, T-CW-1.9).
 *
 * `organizations.follow_up_approval_policy` stores `AUTOMATIC` or
 * `MANAGER_APPROVAL` (a CHECK constraint keeps it to those); the contract
 * spelling is lower case (`FollowUpApprovalPolicy`). This is the one place
 * that maps between them. A stored value outside the two throws rather than
 * falling back to `automatic`: an unknown policy never skips an approval.
 *
 * `organizations` is the tenant anchor and carries no row-level security, so
 * the read needs no organization scope; inside a scoped transaction it runs on
 * that transaction.
 */
import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import type { FollowUpApprovalPolicy } from '@nestself/contracts';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { DbService, type DbExecutor } from '../db/db.service.js';
import { organizations } from '../db/schema/index.js';

export type DbFollowUpApprovalPolicy = 'AUTOMATIC' | 'MANAGER_APPROVAL';

const TO_CONTRACT: Readonly<Record<DbFollowUpApprovalPolicy, FollowUpApprovalPolicy>> = {
  AUTOMATIC: 'automatic',
  MANAGER_APPROVAL: 'manager_approval',
};

const TO_DB: Readonly<Record<FollowUpApprovalPolicy, DbFollowUpApprovalPolicy>> = {
  automatic: 'AUTOMATIC',
  manager_approval: 'MANAGER_APPROVAL',
};

/** The contract spelling of a stored policy; throws on anything else. */
export function toContractFollowUpPolicy(stored: string): FollowUpApprovalPolicy {
  if (!Object.hasOwn(TO_CONTRACT, stored)) throw new Error('Unknown follow_up_approval_policy value');
  return TO_CONTRACT[stored as DbFollowUpApprovalPolicy];
}

/** The stored spelling of a contract policy (T-CW-1.10 writes it). */
export function toDbFollowUpPolicy(policy: FollowUpApprovalPolicy): DbFollowUpApprovalPolicy {
  return TO_DB[policy];
}

@Injectable()
export class FollowUpPolicyReader {
  constructor(private readonly dbs: DbService) {}

  /** The organization's policy. Throws when the organization does not exist. */
  async policyOf(orgId: string, tx?: DbExecutor): Promise<FollowUpApprovalPolicy> {
    const [row] = await (tx ?? this.dbs.db)
      .select({ policy: organizations.followUpApprovalPolicy })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    if (!row) throw new Error('Organization not found for its follow-up policy');
    return toContractFollowUpPolicy(row.policy);
  }
}
