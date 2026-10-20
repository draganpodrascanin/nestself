import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_SESSIONS } from '@nestself/sample-data';
import { OrgRoleSchema } from '@nestself/contracts';
import { routeTree } from './routeTree.gen';
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

function resolveInitialRole() {
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    const parsed = OrgRoleSchema.safeParse(roleParam);
    if (parsed.success) return parsed.data;
  }
  return 'employee' as const;
}

const session = SAMPLE_SESSIONS[resolveInitialRole()];

const router = createRouter({
  routeTree,
  context: {
    queryClient,
    session,
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
