import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  requestContextMiddleware,
  securityMiddleware,
} from '../src/middleware.js';

describe('securityMiddleware', () => {
  it('rejects unauthorized protected route', async () => {
    const app = new Hono();
    app.use('*', requestContextMiddleware());
    app.use(
      '*',
      securityMiddleware({
        authTokens: ['token-1'],
        corsAllowedOrigins: ['*'],
        maxRequestBytes: 1000,
        rateLimitWindowMs: 60000,
        rateLimitMax: 100,
      })
    );
    app.get('/protected', c => c.json({ ok: true }));
    const res = await app.request('http://localhost/protected');
    expect(res.status).toBe(401);
  });

  it('allows request with bearer token', async () => {
    const app = new Hono();
    app.use('*', requestContextMiddleware());
    app.use(
      '*',
      securityMiddleware({
        authTokens: ['token-1'],
        corsAllowedOrigins: ['*'],
        maxRequestBytes: 1000,
        rateLimitWindowMs: 60000,
        rateLimitMax: 100,
      })
    );
    app.get('/protected', c => c.json({ ok: true }));
    const res = await app.request('http://localhost/protected', {
      headers: { authorization: 'Bearer token-1' },
    });
    expect(res.status).toBe(200);
  });
});
