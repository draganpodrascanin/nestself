import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { handleApiError } from './auth/handle-api-error';
import type { ErrorHandlerDeps } from './auth/handle-api-error';
import './i18n';

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

/**
 * Mutable ref for the root component to set auth + router deps into.
 * QueryCache/MutationCache onError reads from it (ruling 6, T-C1.02).
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
  defaultOptions: { queries: { staleTime: 30_000 } },
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

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </StrictMode>,
  );
}
