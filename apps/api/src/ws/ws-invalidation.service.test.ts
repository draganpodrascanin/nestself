/**
 * Unit tests for WsInvalidationService — real-time revocation.
 *
 * @see T-1.11, SESS-R-24, DR-15
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WsInvalidationService } from './ws-invalidation.service.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMocks() {
  const store = {
    subscribe: vi.fn().mockResolvedValue(vi.fn()),
    getDel: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    expire: vi.fn(),
    ttl: vi.fn(),
    incr: vi.fn(),
    sAdd: vi.fn(),
    sRem: vi.fn(),
    sMembers: vi.fn(),
    scan: vi.fn(),
    publish: vi.fn(),
    ping: vi.fn(),
    close: vi.fn(),
  };

  const registry = {
    getSocketsForUser: vi.fn(),
    add: vi.fn(),
    remove: vi.fn(),
    getAllUsers: vi.fn(),
  };

  const principalLoader = {
    load: vi.fn(),
  };

  const authorizer = {
    authorizeSubscription: vi.fn(),
    reauthorizeAll: vi.fn(),
  };

  const service = new WsInvalidationService(
    store,
    registry as never,
    principalLoader as never,
    authorizer as never,
  );

  return { service, store, registry, principalLoader, authorizer };
}

const LOADED_OK = {
  userId: 'user_jovan',
  displayName: 'Jovan',
  initials: 'JP',
  locale: 'sr-Latn',
  memberships: [],
  staffTemplates: [],
  expert: null,
  isSuspended: false,
  isDeactivated: false,
  populationHints: {
    hasStaffGrants: false,
    hasExpertGrants: false,
    hasActiveMembership: true,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WsInvalidationService', () => {
  let mocks: ReturnType<typeof createMocks>;

  beforeEach(() => {
    mocks = createMocks();
  });

  it('disconnects a socket when user becomes suspended', async () => {
    const socket = {
      id: 'sock_1',
      data: {
        principal: { userId: 'user_jovan' },
        subscriptions: new Map(),
      },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };

    mocks.registry.getSocketsForUser.mockReturnValue(new Set([socket]));
    mocks.principalLoader.load.mockResolvedValue({
      ...LOADED_OK,
      isSuspended: true,
    });

    const message = JSON.stringify({
      keys: [],
      reason: 'invalidation',
      userId: 'user_jovan',
    });

    await mocks.service.handleMessage(message);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.emit).toHaveBeenCalledWith('session:revoked', {
      reason: 'suspended',
    });
  });

  it('disconnects a socket when user becomes deactivated', async () => {
    const socket = {
      id: 'sock_2',
      data: {
        principal: { userId: 'user_jovan' },
        subscriptions: new Map(),
      },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };

    mocks.registry.getSocketsForUser.mockReturnValue(new Set([socket]));
    mocks.principalLoader.load.mockResolvedValue({
      ...LOADED_OK,
      isDeactivated: true,
    });

    const message = JSON.stringify({
      keys: [],
      reason: 'invalidation',
      userId: 'user_jovan',
    });

    await mocks.service.handleMessage(message);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(socket.emit).toHaveBeenCalledWith('session:revoked', {
      reason: 'deactivated',
    });
  });

  it('disconnects a socket when user is not found', async () => {
    const socket = {
      id: 'sock_3',
      data: {
        principal: { userId: 'user_gone' },
        subscriptions: new Map(),
      },
      emit: vi.fn(),
      disconnect: vi.fn(),
    };

    mocks.registry.getSocketsForUser.mockReturnValue(new Set([socket]));
    mocks.principalLoader.load.mockResolvedValue(null);

    const message = JSON.stringify({
      keys: [],
      reason: 'invalidation',
      userId: 'user_gone',
    });

    await mocks.service.handleMessage(message);

    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('leaves rooms on grant loss without disconnecting', async () => {
    const subscriptions = new Map([
      [
        'org:org_sample:programme',
        {
          action: 'program.overview',
          resource: { type: 'program', orgId: 'org_sample' },
        },
      ],
    ]);

    const socket = {
      id: 'sock_4',
      data: {
        principal: {
          userId: 'user_jovan',
          memberships: [],
          staffTemplates: [],
          expert: null,
        },
        subscriptions,
      },
      emit: vi.fn(),
      disconnect: vi.fn(),
      leave: vi.fn(),
    };

    mocks.registry.getSocketsForUser.mockReturnValue(new Set([socket]));
    mocks.principalLoader.load.mockResolvedValue(LOADED_OK);
    mocks.authorizer.reauthorizeAll.mockResolvedValue([
      'org:org_sample:programme',
    ]);

    const message = JSON.stringify({
      keys: [],
      reason: 'invalidation',
      userId: 'user_jovan',
    });

    await mocks.service.handleMessage(message);

    // Should NOT disconnect
    expect(socket.disconnect).not.toHaveBeenCalled();
    // Should re-evaluate subscriptions
    expect(mocks.authorizer.reauthorizeAll).toHaveBeenCalledWith(socket);
  });

  it('does nothing for a userId with no connected sockets', async () => {
    mocks.registry.getSocketsForUser.mockReturnValue(new Set());

    const message = JSON.stringify({
      keys: [],
      reason: 'invalidation',
      userId: 'user_nobody',
    });

    await mocks.service.handleMessage(message);

    expect(mocks.principalLoader.load).not.toHaveBeenCalled();
  });

  it('ignores messages without a userId', async () => {
    const message = JSON.stringify({ keys: ['principal:x'], reason: 'test' });

    await mocks.service.handleMessage(message);

    expect(mocks.registry.getSocketsForUser).not.toHaveBeenCalled();
  });
});
