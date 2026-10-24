import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { routeTree } from './routeTree.gen';
import { api } from './api';
import { initialSnapshot } from './auth';
import { isSampleDataMode } from './data-source';
import './i18n';
import './app.css';

// Module augmentation for TanStack Router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const queryClient = new QueryClient({
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
    auth: {
      principal: null,
      effectiveActions: [],
      settled: false,
      // Sample mode has no session to wait for; SampleAuthProvider fills the context.
      ensure: isSampleDataMode ? undefined : () => initialSnapshot(api),
    },
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
