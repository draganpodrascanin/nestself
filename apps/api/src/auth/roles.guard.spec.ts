import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard.js';
import type { AuthUser } from './types.js';

function createMockContext(
  user: AuthUser | undefined,
  params: Record<string, string> = {},
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    getHandler: () => () => {},
    getClass: () => class {},
    getType: () => 'http' as const,
    getArgs: () => [],
    getArgByIndex: () => undefined,
    switchToRpc: () => ({}) as unknown,
    switchToWs: () => ({}) as unknown,
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let guard: RolesGuard;
  let reflector: Reflector;

  const employeeOnOrg1: AuthUser = {
    userId: 'user_1',
    displayName: 'Employee',
    platformRole: null,
    memberships: [{ orgId: 'org_1', role: 'employee' }],
  };

  const hrAdminOnOrg1: AuthUser = {
    userId: 'user_2',
    displayName: 'HR Admin',
    platformRole: null,
    memberships: [{ orgId: 'org_1', role: 'hr_admin' }],
  };

  const hrAdminOnOrg2: AuthUser = {
    userId: 'user_3',
    displayName: 'HR Admin Org 2',
    platformRole: null,
    memberships: [{ orgId: 'org_2', role: 'hr_admin' }],
  };

  const platformOps: AuthUser = {
    userId: 'user_4',
    displayName: 'Operations',
    platformRole: 'operations',
    memberships: [],
  };

  beforeEach(() => {
    reflector = new Reflector();
    guard = new RolesGuard(reflector);
  });

  it('denies an employee for @Roles("hr_admin") on /orgs/org_1/programme', () => {
    const context = createMockContext(employeeOnOrg1, { orgId: 'org_1' });

    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
      ((key: unknown) => {
        if (key === 'roles') return ['hr_admin'];
        if (key === 'orgParam') return 'orgId';
        return undefined;
      }) as typeof reflector.getAllAndOverride,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows hr_admin on org_1 for @Roles("hr_admin") on /orgs/org_1/programme', () => {
    const context = createMockContext(hrAdminOnOrg1, { orgId: 'org_1' });

    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
      ((key: unknown) => {
        if (key === 'roles') return ['hr_admin'];
        if (key === 'orgParam') return 'orgId';
        return undefined;
      }) as typeof reflector.getAllAndOverride,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies hr_admin on org_2 for org_1 route', () => {
    const context = createMockContext(hrAdminOnOrg2, { orgId: 'org_1' });

    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
      ((key: unknown) => {
        if (key === 'roles') return ['hr_admin'];
        if (key === 'orgParam') return 'orgId';
        return undefined;
      }) as typeof reflector.getAllAndOverride,
    );

    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('allows platform operations role regardless of org', () => {
    const context = createMockContext(platformOps, { orgId: 'org_1' });

    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation(
      ((key: unknown) => {
        if (key === 'roles') return ['hr_admin', 'operations', 'admin'];
        if (key === 'orgParam') return 'orgId';
        return undefined;
      }) as typeof reflector.getAllAndOverride,
    );

    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows any authenticated user when no roles metadata is set', () => {
    const context = createMockContext(employeeOnOrg1, {});

    vi.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    expect(guard.canActivate(context)).toBe(true);
  });
});
