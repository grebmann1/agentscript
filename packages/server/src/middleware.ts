import { randomUUID } from 'node:crypto';
import type { Context, MiddlewareHandler } from 'hono';

export interface MiddlewareConfig {
  authTokens: string[];
  /**
   * Bearer tokens accepted on the embedded MCP route. When non-empty, /mcp
   * requires `Authorization: Bearer <token>` like any other protected route.
   * When empty, /mcp stays publicly reachable (local-dev / OSS demo mode) but
   * the demo rate-limit cap still applies.
   */
  mcpAuthTokens: string[];
  corsAllowedOrigins: string[];
  maxRequestBytes: number;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

const rateLimitMap = new Map<string, { count: number; resetAtMs: number }>();
const DEMO_ROUTE_PREFIX = '/demo/agent/';
const MCP_ROUTE_PREFIX = '/mcp/';
const MCP_ROUTE_EXACT = '/mcp';
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
    const mcpRoute = isMcpRoute(pathname);
    const demoNonMcp = isDemoNonMcpRoute(pathname);
    applyCors(c, config.corsAllowedOrigins);
    if (c.req.method === 'OPTIONS') {
      return c.body(null, 204);
    }
    if (mcpRoute) {
      // /mcp authenticates against `mcpAuthTokens` independently of the main
      // API tokens. When the operator has not configured any, the route stays
      // publicly reachable (OSS demo mode); when they have, require a bearer.
      if (
        config.mcpAuthTokens.length > 0 &&
        !isAuthorized(c, config.mcpAuthTokens)
      ) {
        return c.json(
          {
            errorCode: 'UNAUTHORIZED',
            message: 'Missing or invalid MCP bearer token',
          },
          401
        );
      }
    } else if (
      isProtectedRoute(pathname) &&
      !demoNonMcp &&
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
    // /mcp shares the demo cap so the embedded demo MCP server can't be used
    // as a high-throughput unauthenticated endpoint. Surface the path-class so
    // abuse stands out in logs.
    const isCappedDemo = demoNonMcp || mcpRoute;
    const routeRateLimitMax = isCappedDemo
      ? Math.min(config.rateLimitMax, DEMO_RATE_LIMIT_CAP)
      : config.rateLimitMax;
    if (mcpRoute) {
      const requestId = c.get('requestId');
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'mcp_demo_request',
          requestId,
          path: pathname,
        })
      );
    }
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

function isDemoNonMcpRoute(pathname: string): boolean {
  // The non-MCP demo routes (/demo/agent/*) stay auth-bypassed for the OSS
  // landing site. /mcp has its own gate (`mcpAuthTokens`) so it isn't lumped
  // in here.
  return (
    pathname === DEMO_ROUTE_PREFIX.slice(0, -1) ||
    pathname.startsWith(DEMO_ROUTE_PREFIX)
  );
}

function isMcpRoute(pathname: string): boolean {
  return pathname === MCP_ROUTE_EXACT || pathname.startsWith(MCP_ROUTE_PREFIX);
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
