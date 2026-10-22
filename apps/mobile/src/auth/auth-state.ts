/**
 * Auth state machine: a pure reducer with no I/O.
 *
 * The provider dispatches actions; the reducer produces the next state.
 * This is extracted so the state transitions can be tested without
 * mocking React, SecureStore, or fetch.
 *
 * @see auth-strategy.md CLIENT-R-17..26
 */

import type { Principal } from '@nestself/contracts';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  status: AuthStatus;
  principal: Principal | null;
  effectiveActions: readonly string[];
  /** Current OTP sign-in session token from Cognito. */
  otpSession: string | null;
  /** Email for the in-progress sign-in. */
  signInEmail: string | null;
  /** Error from the last operation. */
  error: AuthErrorInfo | null;
}

export interface AuthErrorInfo {
  code: string;
  message: string;
}

export const INITIAL_STATE: AuthState = {
  status: 'loading',
  principal: null,
  effectiveActions: [],
  otpSession: null,
  signInEmail: null,
  error: null,
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type AuthAction =
  | { type: 'LOAD_NO_TOKENS' }
  | { type: 'LOAD_STALE' }
  | { type: 'LOAD_REFRESH_FAILED' }
  | { type: 'LOAD_ME_SUCCESS'; principal: Principal; effectiveActions: readonly string[] }
  | { type: 'LOAD_ME_FAILED' }
  | { type: 'OTP_STARTED'; session: string; email: string }
  | { type: 'OTP_VERIFY_SUCCESS'; principal: Principal; effectiveActions: readonly string[] }
  | { type: 'SSO_SUCCESS'; principal: Principal; effectiveActions: readonly string[] }
  | { type: 'SAMPLE_SIGN_IN'; principal: Principal; effectiveActions: readonly string[] }
  | { type: 'SIGN_OUT' }
  | { type: 'REFRESH_SUCCESS'; principal: Principal; effectiveActions: readonly string[] }
  | { type: 'REFRESH_FAILED' }
  | { type: 'SET_ERROR'; error: AuthErrorInfo }
  | { type: 'CLEAR_ERROR' }
  | { type: 'PRINCIPAL_REFRESHED'; principal: Principal; effectiveActions: readonly string[] };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

export function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOAD_NO_TOKENS':
    case 'LOAD_STALE':
    case 'LOAD_REFRESH_FAILED':
    case 'LOAD_ME_FAILED':
      return {
        ...INITIAL_STATE,
        status: 'unauthenticated',
      };

    case 'LOAD_ME_SUCCESS':
    case 'REFRESH_SUCCESS':
    case 'PRINCIPAL_REFRESHED':
      return {
        ...state,
        status: 'authenticated',
        principal: action.principal,
        effectiveActions: action.effectiveActions,
        otpSession: null,
        signInEmail: null,
        error: null,
      };

    case 'OTP_STARTED':
      return {
        ...state,
        otpSession: action.session,
        signInEmail: action.email,
        error: null,
      };

    case 'OTP_VERIFY_SUCCESS':
    case 'SSO_SUCCESS':
    case 'SAMPLE_SIGN_IN':
      return {
        ...state,
        status: 'authenticated',
        principal: action.principal,
        effectiveActions: action.effectiveActions,
        otpSession: null,
        signInEmail: null,
        error: null,
      };

    case 'SIGN_OUT':
      return {
        ...INITIAL_STATE,
        status: 'unauthenticated',
      };

    case 'REFRESH_FAILED':
      return {
        ...INITIAL_STATE,
        status: 'unauthenticated',
      };

    case 'SET_ERROR':
      return {
        ...state,
        error: action.error,
      };

    case 'CLEAR_ERROR':
      return {
        ...state,
        error: null,
      };
  }
}
