import { createContext, useContext } from 'react';
import type { AuthContextValue } from './types';

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Returns the auth state and actions. Must be used within an AuthProvider.
 * CLIENT-R-01..04
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
