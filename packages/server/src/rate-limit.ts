import type { Context, MiddlewareHandler } from 'hono';

interface Bucket {
  count: number;
  resetAtMs: number;
}

export interface PerIpRateLimitOptions {
  windowMs: number;
  max: number;
  label: string;
}

export function createPerIpRateLimit({
  windowMs,
  max,
  label,
}: PerIpRateLimitOptions): MiddlewareHandler {
  if (windowMs <= 0 || max <= 0) {
    return async (_c, next) => next();
  }
  const buckets = new Map<string, Bucket>();
  return async (c, next) => {
    const ip = clientIp(c);
    const now = Date.now();
    const key = `${label}:${ip}`;
    const current = buckets.get(key);
    if (!current || now > current.resetAtMs) {
      buckets.set(key, { count: 1, resetAtMs: now + windowMs });
    } else if (current.count >= max) {
      const retryAfterSec = Math.max(
        1,
        Math.ceil((current.resetAtMs - now) / 1000)
      );
      c.header('retry-after', String(retryAfterSec));
      return c.json(
        {
          errorCode: 'RATE_LIMITED',
          message: `Too many requests for ${label}. Try again in ${retryAfterSec}s.`,
        },
        429
      );
    } else {
      current.count += 1;
      buckets.set(key, current);
    }
    return next();
  };
}

function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || 'unknown';
}
