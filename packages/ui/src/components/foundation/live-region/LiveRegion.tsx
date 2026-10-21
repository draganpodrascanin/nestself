'use client';

import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface LiveRegionProps {
  politeness: 'polite' | 'assertive';
  children: ReactNode;
}

export function LiveRegion({ politeness, children }: LiveRegionProps) {
  const role = politeness === 'assertive' ? 'alert' : 'status';
  return (
    <div role={role} aria-live={politeness}>
      {children}
    </div>
  );
}

type AnnounceContext = { announce: (message: string) => void };
const AnnounceCtx = createContext<AnnounceContext | null>(null);

export interface AnnouncerProviderProps {
  children: ReactNode;
}

export function AnnouncerProvider({ children }: AnnouncerProviderProps) {
  const [message, setMessage] = useState('');
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const announce = useCallback((msg: string) => {
    // Clear and re-set to ensure AT picks up repeated announcements
    setMessage('');
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setMessage(msg), 50);
  }, []);

  return (
    <AnnounceCtx.Provider value={{ announce }}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {message}
      </div>
    </AnnounceCtx.Provider>
  );
}

export function useAnnounce(): { announce: (message: string) => void } {
  const ctx = useContext(AnnounceCtx);
  if (!ctx) {
    throw new Error('useAnnounce must be used within an AnnouncerProvider');
  }
  return ctx;
}
