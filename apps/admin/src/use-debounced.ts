import { useEffect, useState } from 'react';

/** Delay between the last keystroke in a search field and the request it triggers. */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * `value` as it was `delay` ms ago, once it has stopped changing: every change
 * restarts the wait, so typing sends one request, for the text left at the end.
 */
export function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
