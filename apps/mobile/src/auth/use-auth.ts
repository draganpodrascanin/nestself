/**
 * useAuth hook: the main entry point for auth state in the mobile app.
 *
 * Reads from the AuthContext provided by AuthProvider. Throws if
 * used outside the provider tree.
 */

import { useContext } from 'react';
import { AuthContext } from './auth-provider';
import type { AuthContextValue } from './auth-provider';

export type { AuthContextValue as UseAuth };

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
