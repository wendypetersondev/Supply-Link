/**
 * Tests for GET /api/v1/auditors and POST /api/v1/auditors
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── Mock dependencies ─────────────────────────────────────────────────────────

vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: () => null,
  RATE_LIMIT_PRESETS: { default: {}, publicRead: {}, authenticated: {} },
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: () => Promise.resolve({ apiKey: 'test-key', error: null }),
}));

vi.mock('@/lib/api/metrics', () => ({
  recordRequest: () => {},
}));

vi.mock('@/lib/api/cors', () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handleOptions: () => new Response(null, { status: 204 }),
}));

vi.mock('@/lib/api/errors', () => ({
  withCorrelationId: (_req: unknown, res: unknown) => res,
  apiError: (
    _req: unknown,
    status: number,
    code: string,
    message: string,
    options?: { details?: unknown[] },
  ) =>
    new Response(JSON.stringify({ error: { code, message, details: options?.details } }), {
      status,
    }),
  ErrorCode: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    MISSING_FIELDS: 'MISSING_FIELDS',
    INVALID_PAYLOAD: 'INVALID_PAYLOAD',
  },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import { GET, POST } from '../route';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(method: string, url: string, body?: unknown): NextRequest {
  const init: RequestInit = { method };
  if (body) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return new NextRequest(url, init);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/v1/auditors', () => {
  it('returns a paginated list of auditors', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/auditors');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('items');
    expect(body).toHaveProperty('total');
    expect(Array.isArray(body.items)).toBe(true);
  });

  it('filters to active-only when ?active=true', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/auditors?active=true');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.items.every((a: { active: boolean }) => a.active)).toBe(true);
  });

  it('returns 400 for invalid pagination params', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/auditors?offset=-1');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/auditors', () => {
  it('registers a new auditor', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/auditors', {
      address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      name: 'New Test Auditor',
    });
    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.address).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
    expect(body.name).toBe('New Test Auditor');
    expect(body.active).toBe(true);
  });

  it('returns 400 when address is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/auditors', {
      name: 'Missing Address Auditor',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({
      error: { code: 'VALIDATION_ERROR', details: [expect.objectContaining({ field: 'address' })] },
    });
  });

  it('returns 400 when name is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/auditors', {
      address: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid JSON', async () => {
    const req = new NextRequest('http://localhost/api/v1/auditors', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });
});
