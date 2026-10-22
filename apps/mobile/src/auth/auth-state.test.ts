import { describe, it, expect } from 'vitest';
import { authReducer, INITIAL_STATE } from './auth-state';
import type { AuthState, AuthAction } from './auth-state';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';

const PRINCIPAL = SAMPLE_PRINCIPALS.employee.principal;
const ACTIONS = [...SAMPLE_PRINCIPALS.employee.effectiveActions];

function reduce(actions: AuthAction[], initial: AuthState = INITIAL_STATE): AuthState {
  return actions.reduce(authReducer, initial);
}

describe('authReducer', () => {
  describe('boot sequence', () => {
    it('starts in loading state', () => {
      expect(INITIAL_STATE.status).toBe('loading');
      expect(INITIAL_STATE.principal).toBeNull();
    });

    it('LOAD_NO_TOKENS -> unauthenticated', () => {
      const state = reduce([{ type: 'LOAD_NO_TOKENS' }]);
      expect(state.status).toBe('unauthenticated');
      expect(state.principal).toBeNull();
    });

    it('LOAD_STALE -> unauthenticated', () => {
      const state = reduce([{ type: 'LOAD_STALE' }]);
      expect(state.status).toBe('unauthenticated');
    });

    it('LOAD_REFRESH_FAILED -> unauthenticated', () => {
      const state = reduce([{ type: 'LOAD_REFRESH_FAILED' }]);
      expect(state.status).toBe('unauthenticated');
    });

    it('LOAD_ME_SUCCESS -> authenticated with principal', () => {
      const state = reduce([
        { type: 'LOAD_ME_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
      ]);
      expect(state.status).toBe('authenticated');
      expect(state.principal).toBe(PRINCIPAL);
      expect(state.effectiveActions).toEqual(ACTIONS);
    });

    it('LOAD_ME_FAILED -> unauthenticated', () => {
      const state = reduce([{ type: 'LOAD_ME_FAILED' }]);
      expect(state.status).toBe('unauthenticated');
    });
  });

  describe('OTP flow', () => {
    it('OTP_STARTED sets session and email', () => {
      const state = reduce([
        { type: 'OTP_STARTED', session: 'sess-1', email: 'a@b.com' },
      ]);
      expect(state.otpSession).toBe('sess-1');
      expect(state.signInEmail).toBe('a@b.com');
      expect(state.error).toBeNull();
    });

    it('OTP_VERIFY_SUCCESS -> authenticated, clears OTP state', () => {
      const state = reduce([
        { type: 'OTP_STARTED', session: 'sess-1', email: 'a@b.com' },
        { type: 'OTP_VERIFY_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
      ]);
      expect(state.status).toBe('authenticated');
      expect(state.otpSession).toBeNull();
      expect(state.signInEmail).toBeNull();
    });
  });

  describe('SSO flow', () => {
    it('SSO_SUCCESS -> authenticated', () => {
      const state = reduce([
        { type: 'SSO_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
      ]);
      expect(state.status).toBe('authenticated');
      expect(state.principal).toBe(PRINCIPAL);
    });
  });

  describe('sample mode', () => {
    it('SAMPLE_SIGN_IN -> authenticated', () => {
      const state = reduce([
        { type: 'SAMPLE_SIGN_IN', principal: PRINCIPAL, effectiveActions: ACTIONS },
      ]);
      expect(state.status).toBe('authenticated');
    });
  });

  describe('sign out', () => {
    it('SIGN_OUT from authenticated -> unauthenticated, clears principal', () => {
      const state = reduce([
        { type: 'LOAD_ME_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
        { type: 'SIGN_OUT' },
      ]);
      expect(state.status).toBe('unauthenticated');
      expect(state.principal).toBeNull();
      expect(state.effectiveActions).toEqual([]);
    });
  });

  describe('refresh', () => {
    it('REFRESH_SUCCESS updates principal', () => {
      const state = reduce([
        { type: 'LOAD_ME_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
        { type: 'REFRESH_SUCCESS', principal: PRINCIPAL, effectiveActions: ['new_action'] },
      ]);
      expect(state.status).toBe('authenticated');
      expect(state.effectiveActions).toEqual(['new_action']);
    });

    it('REFRESH_FAILED -> unauthenticated', () => {
      const state = reduce([
        { type: 'LOAD_ME_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
        { type: 'REFRESH_FAILED' },
      ]);
      expect(state.status).toBe('unauthenticated');
      expect(state.principal).toBeNull();
    });
  });

  describe('errors', () => {
    it('SET_ERROR preserves status but sets error', () => {
      const state = reduce([
        { type: 'LOAD_NO_TOKENS' },
        { type: 'SET_ERROR', error: { code: 'invalid_code', message: 'Bad code' } },
      ]);
      expect(state.status).toBe('unauthenticated');
      expect(state.error).toEqual({ code: 'invalid_code', message: 'Bad code' });
    });

    it('CLEAR_ERROR removes error', () => {
      const state = reduce([
        { type: 'SET_ERROR', error: { code: 'unknown', message: 'err' } },
        { type: 'CLEAR_ERROR' },
      ]);
      expect(state.error).toBeNull();
    });
  });

  describe('401 retry scenario', () => {
    it('authenticated -> REFRESH_SUCCESS keeps authenticated', () => {
      const state = reduce([
        { type: 'LOAD_ME_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
        { type: 'REFRESH_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
      ]);
      expect(state.status).toBe('authenticated');
    });

    it('authenticated -> REFRESH_FAILED clears to unauthenticated', () => {
      const state = reduce([
        { type: 'LOAD_ME_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
        { type: 'REFRESH_FAILED' },
      ]);
      expect(state.status).toBe('unauthenticated');
    });
  });

  describe('PRINCIPAL_REFRESHED', () => {
    it('updates principal in place', () => {
      const newPrincipal = { ...PRINCIPAL, displayName: 'Updated Name' };
      const state = reduce([
        { type: 'LOAD_ME_SUCCESS', principal: PRINCIPAL, effectiveActions: ACTIONS },
        { type: 'PRINCIPAL_REFRESHED', principal: newPrincipal, effectiveActions: ['more'] },
      ]);
      expect(state.principal?.displayName).toBe('Updated Name');
      expect(state.effectiveActions).toEqual(['more']);
    });
  });
});
