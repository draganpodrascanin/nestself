import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { handleApiError } from './auth/handle-api-error';
import { globalErrorDepsRef } from './auth/global-error-deps';
import { api } from './api';
import { initialSnapshot } from './auth';
import { isSampleDataMode } from './data-source';
import { shouldRetryQuery } from './query-retry';
import './i18n';

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

export { globalErrorDepsRef };

const onCacheError = (error: Error) => {
  if (globalErrorDepsRef.current) {
    handleApiError(error, globalErrorDepsRef.current);
  }
};

const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onCacheError }),
  mutationCache: new MutationCache({ onError: onCacheError }),
  defaultOptions: { queries: { staleTime: 30_000, retry: shouldRetryQuery } },
});

const router = createRouter({
  routeTree,
  context: {
    queryClient,
    auth: {
      principal: null,
      effectiveActions: [],
      availableContexts: [],
      settled: false,
      // Sample mode has no session to wait for; SampleAuthProvider fills the context.
      ensure: isSampleDataMode ? undefined : () => initialSnapshot(api),
    },
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
