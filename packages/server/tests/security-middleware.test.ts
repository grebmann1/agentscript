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
        mcpAuthTokens: [],
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
        mcpAuthTokens: [],
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

  it('leaves /mcp publicly reachable when mcpAuthTokens is empty', async () => {
    // Unauth mode: API tokens may gate other routes, but /mcp stays open so
    // OSS users can try the demo without configuring tokens.
    const app = new Hono();
    app.use('*', requestContextMiddleware());
    app.use(
      '*',
      securityMiddleware({
        authTokens: ['token-1'],
        mcpAuthTokens: [],
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

  it('rejects /mcp without bearer when mcpAuthTokens is configured', async () => {
    const app = new Hono();
    app.use('*', requestContextMiddleware());
    app.use(
      '*',
      securityMiddleware({
        authTokens: [],
        mcpAuthTokens: ['mcp-secret'],
        corsAllowedOrigins: ['*'],
        maxRequestBytes: 1000,
        rateLimitWindowMs: 60000,
        rateLimitMax: 100,
      })
    );
    app.post('/mcp', c => c.json({ ok: true }));
    const res = await app.request('http://localhost/mcp', { method: 'POST' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.message).toMatch(/MCP bearer token/);
  });

  it('accepts /mcp with the configured MCP bearer token', async () => {
    const app = new Hono();
    app.use('*', requestContextMiddleware());
    app.use(
      '*',
      securityMiddleware({
        authTokens: [],
        mcpAuthTokens: ['mcp-secret'],
        corsAllowedOrigins: ['*'],
        maxRequestBytes: 1000,
        rateLimitWindowMs: 60000,
        rateLimitMax: 100,
      })
    );
    app.post('/mcp', c => c.json({ ok: true }));
    const res = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer mcp-secret' },
    });
    expect(res.status).toBe(200);
  });

  it('keeps /mcp and main API tokens independent', async () => {
    // A token valid for the main API must NOT unlock /mcp, and vice-versa.
    const app = new Hono();
    app.use('*', requestContextMiddleware());
    app.use(
      '*',
      securityMiddleware({
        authTokens: ['api-token'],
        mcpAuthTokens: ['mcp-token'],
        corsAllowedOrigins: ['*'],
        maxRequestBytes: 1000,
        rateLimitWindowMs: 60000,
        rateLimitMax: 100,
      })
    );
    app.post('/mcp', c => c.json({ ok: true }));
    app.get('/protected', c => c.json({ ok: true }));

    const mcpWithApi = await app.request('http://localhost/mcp', {
      method: 'POST',
      headers: { authorization: 'Bearer api-token' },
    });
    expect(mcpWithApi.status).toBe(401);

    const apiWithMcp = await app.request('http://localhost/protected', {
      headers: { authorization: 'Bearer mcp-token' },
    });
    expect(apiWithMcp.status).toBe(401);
  });

  it('does not exempt routes that merely start with /mcp- prefix', async () => {
    // Guard against a regex/startsWith bug accidentally matching /mcpfoo.
    const app = new Hono();
    app.use('*', requestContextMiddleware());
    app.use(
      '*',
      securityMiddleware({
        authTokens: ['token-1'],
        mcpAuthTokens: [],
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
