import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { createPerIpRateLimit } from '../src/rate-limit.js';

describe('createPerIpRateLimit', () => {
  it('passes through when window or max is 0', async () => {
    const app = new Hono();
    app.use('*', createPerIpRateLimit({ windowMs: 0, max: 5, label: 'test' }));
    app.get('/x', c => c.json({ ok: true }));
    const res = await app.request('http://localhost/x', {
      headers: { 'x-forwarded-for': '1.2.3.4' },
    });
    expect(res.status).toBe(200);
  });

  it('returns 429 once max is reached for the same IP', async () => {
    const app = new Hono();
    app.use(
      '*',
      createPerIpRateLimit({ windowMs: 60_000, max: 2, label: 'sessions' })
    );
    app.get('/x', c => c.json({ ok: true }));
    const headers = { 'x-forwarded-for': '9.9.9.9' };
    const r1 = await app.request('http://localhost/x', { headers });
    const r2 = await app.request('http://localhost/x', { headers });
    const r3 = await app.request('http://localhost/x', { headers });
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.headers.get('retry-after')).toMatch(/^\d+$/);
    const body = (await r3.json()) as { errorCode: string; message: string };
    expect(body.errorCode).toBe('RATE_LIMITED');
  });

  it('tracks per-IP independently', async () => {
    const app = new Hono();
    app.use(
      '*',
      createPerIpRateLimit({ windowMs: 60_000, max: 1, label: 'messages' })
    );
    app.get('/x', c => c.json({ ok: true }));
    const a1 = await app.request('http://localhost/x', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    const a2 = await app.request('http://localhost/x', {
      headers: { 'x-forwarded-for': '10.0.0.1' },
    });
    const b1 = await app.request('http://localhost/x', {
      headers: { 'x-forwarded-for': '10.0.0.2' },
    });
    expect(a1.status).toBe(200);
    expect(a2.status).toBe(429);
    expect(b1.status).toBe(200);
  });
});
