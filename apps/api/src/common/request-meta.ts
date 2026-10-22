/**
 * Extract request metadata (IP, user-agent, request id) from an Express request.
 * Respects `TRUST_PROXY_HOPS` for `X-Forwarded-For`.
 *
 * @see API-R-33, AUDIT-R-xx
 */
/** Minimal Express-compatible request shape (avoids depending on @types/express). */
interface HttpReq {
  headers: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  id?: string;
}

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
}

/**
 * Return the client IP, user-agent, and pino-http request id from the request.
 *
 * When `trustProxyHops > 0`, the IP is taken from `X-Forwarded-For` counting
 * backwards from the rightmost entry (the entry set by the nearest trusted proxy).
 */
export function requestMeta(
  req: HttpReq,
  trustProxyHops = 0,
): RequestMeta {
  let ip: string | null = null;

  if (trustProxyHops > 0) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string') {
      const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
      // Take the entry `trustProxyHops` positions from the right
      const idx = parts.length - trustProxyHops;
      ip = idx >= 0 ? parts[idx]! : parts[0] ?? null;
    }
  }

  if (!ip) {
    ip = req.socket?.remoteAddress ?? null;
  }

  const userAgent =
    typeof req.headers['user-agent'] === 'string'
      ? req.headers['user-agent']
      : null;

  const requestId = req.id ?? null;

  return { ip, userAgent, requestId };
}
