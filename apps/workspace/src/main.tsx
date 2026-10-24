import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { handleApiError } from './auth/handle-api-error';
import type { ErrorHandlerDeps } from './auth/handle-api-error';
import './i18n';
import './app.css';

// Module augmentation for TanStack Router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/**
 * Mutable ref that the root component sets once auth and router are available.
 * The QueryCache/MutationCache onError callbacks read from it so that
 * org_context_expired and 401 errors are handled globally (ruling 6).
 */
export const globalErrorDepsRef: { current: ErrorHandlerDeps | null } = { current: null };

const onCacheError = (error: Error) => {
  if (globalErrorDepsRef.current) {
    handleApiError(error, globalErrorDepsRef.current);
  }
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onCacheError }),
  mutationCache: new MutationCache({ onError: onCacheError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

const router = createRouter({
  routeTree,
  context: {
    queryClient,
    auth: { principal: null, effectiveActions: [], availableContexts: [] },
  },
  defaultPreload: 'intent',
  scrollRestoration: true,
});

const rootEl = document.getElementById('root');
if (rootEl) {
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
