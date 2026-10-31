import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { SEARCH_DEBOUNCE_MS, useDebounced } from './use-debounced';

describe('useDebounced', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('search fields wait 300 ms', () => {
    expect(SEARCH_DEBOUNCE_MS).toBe(300);
  });

  it('starts with the value it is given', () => {
    const { result } = renderHook(() => useDebounced('first', SEARCH_DEBOUNCE_MS));
    expect(result.current).toBe('first');
  });

  it('follows a change once the delay has passed since the last change', () => {
    const { result, rerender } = renderHook(({ value }) => useDebounced(value, SEARCH_DEBOUNCE_MS), {
      initialProps: { value: 'a' },
    });

    rerender({ value: 'ab' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(result.current).toBe('a');

    // Another keystroke restarts the wait.
    rerender({ value: 'abc' });
    act(() => {
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    });
    expect(result.current).toBe('a');

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current).toBe('abc');
  });
});
