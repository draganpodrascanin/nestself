import { queryOptions } from '@tanstack/react-query';
import { HealthResponseSchema } from '@nestself/contracts';
import type { ApiClient } from '../client';

export const healthQueryOptions = (client: ApiClient) =>
  queryOptions({
    queryKey: ['health'],
    queryFn: () =>
      client.request('/api/health', { schema: HealthResponseSchema }),
    staleTime: 30_000,
    retry: 1,
  });
