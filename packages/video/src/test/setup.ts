import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});

// `waitFor` and `findBy*` wait up to 3 s: Motion exits and fake round trips run late on a loaded machine.
configure({ asyncUtilTimeout: 3_000 });

// Polyfill window.matchMedia for jsdom
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

// Polyfill ResizeObserver for jsdom
class ResizeObserverPolyfill {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverPolyfill as unknown as typeof ResizeObserver;

// Polyfill Element.prototype.scrollIntoView for jsdom
Element.prototype.scrollIntoView = function () {};

// Polyfill HTMLDialogElement.prototype.showModal/close for jsdom
if (typeof HTMLDialogElement !== 'undefined') {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function () {
      this.setAttribute('open', '');
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function () {
      this.removeAttribute('open');
    };
  }
} else {
  // jsdom may not have HTMLDialogElement at all
  (globalThis as Record<string, unknown>).HTMLDialogElement = class HTMLDialogElement extends HTMLElement {
    showModal() {
      this.setAttribute('open', '');
    }
    close() {
      this.removeAttribute('open');
    }
  };
}
