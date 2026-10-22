import { queryOptions } from '@tanstack/react-query';
import type { AuthApi } from '../auth';

/** TanStack Query options for `GET /auth/me`. */
export const meQueryOptions = (authApi: AuthApi) =>
  queryOptions({
    queryKey: ['auth', 'me'],
    queryFn: () => authApi.me(),
    staleTime: 60_000,
    retry: false,
  });
