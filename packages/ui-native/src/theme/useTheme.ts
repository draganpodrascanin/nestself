import { useContext } from 'react';
import { ThemeContext } from './ThemeProvider';
import type { ThemeState } from './types';

/**
 * Returns the current native theme from the nearest ThemeProvider.
 * Must be used within a ThemeProvider.
 */
export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}
