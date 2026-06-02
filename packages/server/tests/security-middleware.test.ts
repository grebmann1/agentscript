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

  it('exempts /mcp from auth as a public demo route', async () => {
    // The embedded MCP server at /mcp is demo-only. Even with authTokens
    // configured, /mcp must be reachable without a bearer (the demo rate
    // limit cap still applies — see other tests).
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
    app.get('/mcp', c => c.json({ ok: true }));
    app.get('/mcp/sub/path', c => c.json({ ok: true }));
    const exact = await app.request('http://localhost/mcp');
    const sub = await app.request('http://localhost/mcp/sub/path');
    expect(exact.status).toBe(200);
    expect(sub.status).toBe(200);
  });

  it('does not exempt routes that merely start with /mcp- prefix', async () => {
    // Guard against a regex/startsWith bug accidentally matching /mcpfoo.
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
    app.get('/mcpfoo', c => c.json({ ok: true }));
    const res = await app.request('http://localhost/mcpfoo');
    expect(res.status).toBe(401);
  });
});
