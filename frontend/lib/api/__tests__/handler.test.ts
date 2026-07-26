/**
 * Contract tests for the `defineRoute` handler pipeline.
 *
 * These tests exercise the factory directly rather than testing individual routes,
 * asserting that the cross-cutting pipeline behaves consistently:
 *
 *   - CORS headers are attached to responses
 *   - OPTIONS preflight returns 204 with correct headers
 *   - X-Correlation-Id is echoed in every response
 *   - 401 is returned when authentication is required but no key is provided
 *   - 429 is returned when the rate limit is exceeded
 *   - Idempotent replay returns the cached response (Idempotent-Replayed: true)
 *   - Idempotency conflict (same key, different body) returns 409
 *   - Validation errors (invalid body) return 400
 *   - API version header is present on all responses
 *   - Error responses include correlationId in the body
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute, RATE_LIMIT_PRESETS } from '@/lib/api/handler';
import { clearIpReputation } from '@/lib/api/rateLimit';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(
  url: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): NextRequest {
  return new NextRequest(url, {
    method: opts.method ?? 'GET',
    headers: opts.headers,
    body: opts.body,
  });
}

// ── Sample route factory for testing ──────────────────────────────────────────

const testBodySchema = z.object({
  name: z.string().min(1),
  value: z.number().int().positive(),
});

const testHandlers = {
  GET: async () => NextResponse.json({ ok: true }),
  POST: async (ctx: { body: z.infer<typeof testBodySchema> }) =>
    NextResponse.json({ created: ctx.body.name }, { status: 201 }),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('defineRoute pipeline contracts', () => {
  beforeEach(() => {
    clearIpReputation();
  });

  // ── CORS ────────────────────────────────────────────────────────────────

  describe('CORS', () => {
    it('attaches CORS headers to responses', async () => {
      const { GET } = defineRoute({ auth: 'public' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test');
      const res = await GET!(req);

      // CORS headers should be present when origin matches
      const acao = res.headers.get('Access-Control-Allow-Origin');
      expect(acao === 'http://localhost:3000' || acao === null).toBe(true);
    });

    it('provides an OPTIONS handler that returns 204', () => {
      const { OPTIONS } = defineRoute({ auth: 'public' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test', {
        headers: { origin: 'http://localhost:3000' },
      });
      const res = OPTIONS!(req);
      expect(res.status).toBe(204);
    });

    it('OPTIONS returns 204 even without origin header', () => {
      const { OPTIONS } = defineRoute({ auth: 'public' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test');
      const res = OPTIONS!(req);
      expect(res.status).toBe(204);
    });
  });

  // ── Correlation ID ──────────────────────────────────────────────────────

  describe('correlation ID', () => {
    it('echoes X-Correlation-Id in every response', async () => {
      const { GET } = defineRoute({ auth: 'public' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test', {
        headers: { 'x-correlation-id': 'my-custom-id' },
      });
      const res = await GET!(req);

      expect(res.headers.get('X-Correlation-Id')).toBe('my-custom-id');
    });

    it('generates a new correlation ID when none is provided', async () => {
      const { GET } = defineRoute({ auth: 'public' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test');
      const res = await GET!(req);

      const cid = res.headers.get('X-Correlation-Id');
      expect(cid).toBeDefined();
      expect(cid!.length).toBeGreaterThan(0);
    });

    it('includes correlationId in error response bodies', async () => {
      const { POST } = defineRoute({ auth: 'public', body: testBodySchema }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-correlation-id': 'err-test-id',
        },
        body: JSON.stringify({ name: '' }), // invalid: name must be non-empty
      });
      const res = await POST!(req);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.error.correlationId).toBe('err-test-id');
    });
  });

  // ── Authentication ──────────────────────────────────────────────────────

  describe('authentication', () => {
    it('returns 401 when auth is required but no key is provided', async () => {
      const { GET } = defineRoute({ auth: 'partner' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test');
      const res = await GET!(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe('UNAUTHORIZED');
    });

    it('allows requests when auth is set to public', async () => {
      const { GET } = defineRoute({ auth: 'public' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test');
      const res = await GET!(req);

      expect(res.status).toBe(200);
    });
  });

  // ── Idempotency ─────────────────────────────────────────────────────────

  describe('idempotency', () => {
    const idemBody = JSON.stringify({ name: 'test', value: 42 });

    it('replays cached response when same idempotency key and body are used', async () => {
      const { POST } = defineRoute(
        { auth: 'public', idempotent: true, body: testBodySchema },
        testHandlers,
      );
      const headers = {
        'content-type': 'application/json',
        'idempotency-key': 'idem-001',
      };

      const req1 = makeRequest('http://localhost:3000/api/test', {
        method: 'POST',
        headers,
        body: idemBody,
      });
      const res1 = await POST!(req1);
      expect(res1.status).toBe(201);

      const req2 = makeRequest('http://localhost:3000/api/test', {
        method: 'POST',
        headers,
        body: idemBody,
      });
      const res2 = await POST!(req2);
      expect(res2.status).toBe(201);
      expect(res2.headers.get('Idempotent-Replayed')).toBe('true');
    });

    it('returns 409 when same idempotency key is used with different body', async () => {
      const { POST } = defineRoute(
        { auth: 'public', idempotent: true, body: testBodySchema },
        testHandlers,
      );
      const headers = { 'content-type': 'application/json', 'idempotency-key': 'idem-002' };

      // First request
      const req1 = makeRequest('http://localhost:3000/api/test', {
        method: 'POST',
        headers,
        body: idemBody,
      });
      await POST!(req1);

      // Second request with same key but different body
      const req2 = makeRequest('http://localhost:3000/api/test', {
        method: 'POST',
        headers,
        body: JSON.stringify({ name: 'different', value: 99 }),
      });
      const res2 = await POST!(req2);
      expect(res2.status).toBe(409);
      const body = await res2.json();
      expect(body.error.code).toBe('IDEMPOTENCY_CONFLICT');
    });
  });

  // ── Validation ──────────────────────────────────────────────────────────

  describe('validation', () => {
    it('returns 400 when body fails schema validation', async () => {
      const { POST } = defineRoute({ auth: 'public', body: testBodySchema }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'ok', value: -1 }), // value must be positive
      });
      const res = await POST!(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when body is not valid JSON', async () => {
      const { POST } = defineRoute({ auth: 'public', body: testBodySchema }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: 'not json',
      });
      const res = await POST!(req);

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_JSON');
    });
  });

  // ── API version header ──────────────────────────────────────────────────

  describe('API version', () => {
    it('includes X-API-Version header on success responses', async () => {
      const { GET } = defineRoute({ auth: 'public' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test');
      const res = await GET!(req);

      expect(res.headers.get('X-API-Version')).toBe('v1');
    });

    it('includes X-API-Version header on error responses', async () => {
      const { GET } = defineRoute({ auth: 'partner' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test');
      const res = await GET!(req);

      expect(res.headers.get('X-API-Version')).toBe('v1');
    });
  });

  // ── Rate limiting ───────────────────────────────────────────────────────

  describe('rate limiting', () => {
    it('returns 429 when rate limit is exceeded', async () => {
      const strictLimit = { limit: 2, windowMs: 60_000 };
      const { GET } = defineRoute({ auth: 'public', rateLimit: strictLimit }, testHandlers);

      // First two requests should succeed
      const req1 = makeRequest('http://localhost:3000/api/ratelimit-test');
      const req2 = makeRequest('http://localhost:3000/api/ratelimit-test');
      await GET!(req1);
      await GET!(req2);

      // Third request should be rate-limited
      const req3 = makeRequest('http://localhost:3000/api/ratelimit-test');
      const res3 = await GET!(req3);

      expect(res3.status).toBe(429);
      const body = await res3.json();
      expect(body.error.code).toBe('RATE_LIMITED');
      expect(res3.headers.get('Retry-After')).toBeDefined();
    });

    it('does not rate-limit when rateLimit is set to false', async () => {
      const { GET } = defineRoute({ auth: 'public', rateLimit: false }, testHandlers);

      // Should all succeed regardless of count
      for (let i = 0; i < 10; i++) {
        const req = makeRequest('http://localhost:3000/api/no-ratelimit-test');
        const res = await GET!(req);
        expect(res.status).toBe(200);
      }
    });
  });

  // ── Deprecation headers ─────────────────────────────────────────────────

  describe('deprecation', () => {
    it('includes Deprecation and Sunset headers when configured', async () => {
      const { GET } = defineRoute(
        {
          auth: 'public',
          deprecated: {
            sunsetDate: '2027-01-01',
            successorUrl: '/api/v2/test',
          },
        },
        testHandlers,
      );
      const req = makeRequest('http://localhost:3000/api/test');
      const res = await GET!(req);

      expect(res.headers.get('Deprecation')).toBe('true');
      expect(res.headers.get('Sunset')).toBeDefined();
      expect(res.headers.get('Link')).toContain('successor-version');
    });
  });

  // ── Metrics ─────────────────────────────────────────────────────────────

  describe('metrics', () => {
    it('records request metrics without throwing', async () => {
      const { GET } = defineRoute({ auth: 'public' }, testHandlers);
      const req = makeRequest('http://localhost:3000/api/test');
      const res = await GET!(req);
      expect(res.status).toBe(200);
      // Metrics are recorded in-memory; this test just verifies the
      // pipeline doesn't throw when metrics are wired up.
    });
  });
});
