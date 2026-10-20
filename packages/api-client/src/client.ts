import type { z } from 'zod';
import { ApiError } from './errors.js';

export interface ApiClientOptions {
  baseUrl: string;
  getToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  request<T>(
    path: string,
    init: RequestInit & { schema: z.ZodType<T> },
  ): Promise<T>;
  baseUrl: string;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const { baseUrl, getToken, fetchImpl = fetch } = opts;

  return {
    baseUrl,

    async request<T>(
      path: string,
      init: RequestInit & { schema: z.ZodType<T> },
    ): Promise<T> {
      const { schema, ...fetchInit } = init;
      const headers = new Headers(fetchInit.headers);
      headers.set('Accept', 'application/json');

      if (getToken) {
        const token = await getToken();
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
        }
      }

      let response: Response;
      try {
        response = await fetchImpl(`${baseUrl}${path}`, {
          ...fetchInit,
          headers,
        });
      } catch {
        throw new ApiError({
          status: 0,
          code: 'network',
          message: 'Network request failed',
          requestId: null,
        });
      }

      const requestId = response.headers.get('x-request-id');

      if (!response.ok) {
        let message: string = response.statusText;
        try {
          const body = (await response.json()) as Record<string, unknown>;
          if (typeof body.message === 'string') {
            message = body.message;
          } else if (typeof body.error === 'string') {
            message = body.error;
          }
        } catch {
          // use statusText as fallback
        }
        throw new ApiError({
          status: response.status,
          code: String(response.status),
          message,
          requestId,
        });
      }

      const json: unknown = await response.json();
      try {
        return schema.parse(json) as T;
      } catch {
        throw new ApiError({
          status: response.status,
          code: 'invalid_response',
          message: 'Response validation failed',
          requestId,
        });
      }
    },
  };
}
