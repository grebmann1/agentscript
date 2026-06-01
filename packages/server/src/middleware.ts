import { randomUUID } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

export interface MiddlewareConfig {
  authTokens: string[];
  corsAllowedOrigins: string[];
  maxRequestBytes: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

const rateLimitMap = new Map<string, { count: number; resetAtMs: number }>();
const DEMO_ROUTE_PREFIX = '/demo/agent/';
const DEMO_RATE_LIMIT_CAP = 20;

export function requestContextMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const requestId = c.req.header('x-request-id') ?? randomUUID();
    c.set('requestId', requestId);
    c.header('x-request-id', requestId);
    await next();
  };
}

export function loggingMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    const start = Date.now();
    await next();
    const latencyMs = Date.now() - start;
    const requestId = c.get('requestId');
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'http_request',
        requestId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        status: c.res.status,
        latencyMs,
      })
    );
  };
}

export function securityMiddleware(
  config: MiddlewareConfig
): MiddlewareHandler {
  return async (c, next) => {
    const pathname = new URL(c.req.url).pathname;
    const demoRoute = isPublicDemoRoute(pathname);
    applyCors(c, config.corsAllowedOrigins);
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    if (
      isProtectedRoute(pathname) &&
      !demoRoute &&
      !isAuthorized(c, config.authTokens)
    ) {
      return c.json(
        {
          errorCode: 'UNAUTHORIZED',
          message: 'Missing or invalid bearer token',
        },
        401
      );
    }
    if (isRequestTooLarge(c, config.maxRequestBytes)) {
      return c.json(
        { errorCode: 'REQUEST_TOO_LARGE', message: 'Payload exceeds limit' },
        413
      );
    }
    const routeRateLimitMax = demoRoute
      ? Math.min(config.rateLimitMax, DEMO_RATE_LIMIT_CAP)
      : config.rateLimitMax;
    if (!checkRateLimit(c, config.rateLimitWindowMs, routeRateLimitMax)) {
      return c.json(
        { errorCode: 'RATE_LIMITED', message: 'Too many requests' },
        429
      );
    }
    return await next();
  };
}

function isProtectedRoute(pathname: string): boolean {
  return (
    pathname !== '/healthz' && pathname !== '/readyz' && pathname !== '/metrics'
  );
}

function isPublicDemoRoute(pathname: string): boolean {
  return (
    pathname === DEMO_ROUTE_PREFIX.slice(0, -1) ||
    pathname.startsWith(DEMO_ROUTE_PREFIX)
  );
}

function isAuthorized(c: Context, allowedTokens: string[]): boolean {
  if (allowedTokens.length === 0) return true;
  const header = c.req.header('authorization');
  if (!header?.startsWith('Bearer ')) return false;
  const token = header.slice('Bearer '.length).trim();
  if (!token) return false;
  c.set('authSubject', token.slice(0, 8));
  return allowedTokens.includes(token);
}

function isRequestTooLarge(c: Context, maxRequestBytes: number): boolean {
  if (maxRequestBytes <= 0) return false;
  const contentLength = c.req.header('content-length');
  if (!contentLength) return false;
  const bytes = Number.parseInt(contentLength, 10);
  return Number.isFinite(bytes) && bytes > maxRequestBytes;
}

function checkRateLimit(
  c: Context,
  windowMs: number,
  maxRequests: number
): boolean {
  if (windowMs <= 0 || maxRequests <= 0) return true;
  const forwarded = c.req.header('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || 'unknown';
  const subject = c.get('authSubject') ?? 'anon';
  const key = `${subject}:${ip}`;
  const now = Date.now();
  const current = rateLimitMap.get(key);
  if (!current || now > current.resetAtMs) {
    rateLimitMap.set(key, { count: 1, resetAtMs: now + windowMs });
    return true;
  }
  if (current.count >= maxRequests) {
    return false;
  }
  current.count += 1;
  rateLimitMap.set(key, current);
  return true;
}

function applyCors(c: Context, allowedOrigins: string[]): void {
  const origin = c.req.header('origin');
  if (!origin) return;
  const isAllowed =
    allowedOrigins.includes('*') || allowedOrigins.includes(origin);
  if (!isAllowed) return;
  c.header('access-control-allow-origin', origin);
  c.header('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  c.header(
    'access-control-allow-headers',
    'authorization,content-type,x-request-id'
  );
}
