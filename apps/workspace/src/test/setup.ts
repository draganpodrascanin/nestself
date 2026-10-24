import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// Polyfill window.matchMedia for jsdom (required by motion / Base UI)
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Polyfill ResizeObserver for jsdom (required by Base UI Positioner)
class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;

// Polyfill Element.prototype.scrollIntoView for jsdom
Element.prototype.scrollIntoView = function () {};
