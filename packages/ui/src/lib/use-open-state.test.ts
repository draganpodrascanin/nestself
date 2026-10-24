import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useOpenState } from './use-open-state';

describe('useOpenState', () => {
  it('uncontrolled: starts from defaultOpen and follows setOpen', () => {
    const onOpenChange = vi.fn();
    const { result } = renderHook(() => useOpenState({ defaultOpen: true, onOpenChange }));
    expect(result.current[0]).toBe(true);
    act(() => result.current[1](false));
    expect(result.current[0]).toBe(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('controlled: reports the request but keeps the value from props', () => {
    const onOpenChange = vi.fn();
    const { result, rerender } = renderHook(({ open }) => useOpenState({ open, onOpenChange }), {
      initialProps: { open: false },
    });
    act(() => result.current[1](true));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    expect(result.current[0]).toBe(false);
    rerender({ open: true });
    expect(result.current[0]).toBe(true);
  });
});
