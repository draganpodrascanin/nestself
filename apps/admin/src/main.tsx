import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient } from '@tanstack/react-query';
import { SAMPLE_SESSIONS } from '@nestself/sample-data';
import { PlatformRoleSchema } from '@nestself/contracts';
import { routeTree } from './routeTree.gen';
import './i18n';

function resolveSession() {
  if (import.meta.env.DEV) {
    const params = new URLSearchParams(window.location.search);
    const roleParam = params.get('role');
    if (roleParam) {
      const parsed = PlatformRoleSchema.safeParse(roleParam);
      if (parsed.success) return SAMPLE_SESSIONS[parsed.data];
    }
  }
  return SAMPLE_SESSIONS.admin;
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000 } },
});

const router = createRouter({
  routeTree,
  context: {
    queryClient,
    session: resolveSession(),
  },
  defaultPreload: 'intent',
  scrollRestoration: true,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
