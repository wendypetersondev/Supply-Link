/**
 * Integration tests for the attestation routes:
 *   POST /api/v1/attestations          — add attestation
 *   GET  /api/v1/attestations          — list by productId or issuerAddress
 *   GET  /api/v1/attestations/[id]     — get single attestation
 *   DELETE /api/v1/attestations/[id]   — revoke attestation
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

// ── KV mock ───────────────────────────────────────────────────────────────────

const kvData = new Map<string, string>();

vi.mock('@/lib/kv', () => ({
  kvStore: {
    get: vi.fn(async (key: string) => kvData.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      kvData.set(key, value);
    }),
    del: vi.fn(async (key: string) => {
      kvData.delete(key);
    }),
  },
}));

// ── Registry auth mock — auditor tier ─────────────────────────────────────────

vi.mock('@/lib/api/apiKeyAuth', () => ({
  authenticateRegistryKey: vi.fn(async (req: NextRequest) => {
    const key = req.headers.get('x-api-key');
    if (key === 'valid-auditor-key') return { error: null, keyId: 'kid_test', tier: 'auditor' };
    const { NextResponse } = await import('next/server');
    return {
      error: NextResponse.json(
        {
          error: {
            status: 401,
            code: 'UNAUTHORIZED',
            message: 'Invalid API key',
            correlationId: 'test',
          },
        },
        { status: 401 },
      ),
    };
  }),
}));

// ── Rate limit mock ───────────────────────────────────────────────────────────

vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
  RATE_LIMIT_PRESETS: { default: {}, publicRead: {} },
}));

// ── Correlation mock ──────────────────────────────────────────────────────────

vi.mock('@/lib/api/correlation', () => ({
  getCorrelationId: vi.fn(() => 'test-correlation-id'),
}));

import { POST, GET } from '../route';
import { GET as getById, DELETE as deleteById } from '../[attestationId]/route';

function makeRequest(
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
): NextRequest {
  const init: RequestInit = {
    method,
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'valid-auditor-key',
      ...headers,
    },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return new NextRequest(url, init);
}

const VALID_ATTESTATION = {
  productId: 'prod-001',
  issuerAddress: 'GAUDITOR123',
  issuerName: 'Acme Auditors',
  trustLevel: 'verified',
  attestationType: 'audit',
  summary: 'Annual supply chain audit passed',
  signedReference: 'sha256:abc123def456',
};

beforeEach(() => {
  kvData.clear();
  vi.clearAllMocks();
});

// ── POST /api/v1/attestations ─────────────────────────────────────────────────

describe('POST /api/v1/attestations', () => {
  it('creates an attestation and returns 201', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/attestations', VALID_ATTESTATION);
    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.attestationId).toMatch(/^att_/);
    expect(body.productId).toBe('prod-001');
    expect(body.trustLevel).toBe('verified');
    expect(body.revoked).toBe(false);
  });

  it('returns 400 for missing required fields', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/attestations', {
      productId: 'p1',
      // missing issuerAddress, issuerName, etc.
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'issuerAddress',
          location: 'body',
          code: expect.any(String),
        }),
      ]),
    );
  });

  it('returns 400 for invalid trustLevel', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/attestations', {
      ...VALID_ATTESTATION,
      trustLevel: 'platinum', // invalid
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'trustLevel', location: 'body' })]),
    );
  });

  it('returns 400 for invalid attestationType', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/attestations', {
      ...VALID_ATTESTATION,
      attestationType: 'unknown_type',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'attestationType', location: 'body' }),
      ]),
    );
  });

  it('returns 400 for invalid reportUrl', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/attestations', {
      ...VALID_ATTESTATION,
      reportUrl: 'not-a-url',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'reportUrl', location: 'body' })]),
    );
  });

  it('returns 401 without a valid API key', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/attestations', VALID_ATTESTATION, {
      'x-api-key': 'wrong-key',
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
  });
});

// ── GET /api/v1/attestations ──────────────────────────────────────────────────

describe('GET /api/v1/attestations', () => {
  it('returns 400 when neither productId nor issuerAddress is provided', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/attestations');
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: '$', location: 'query' })]),
    );
  });

  it('returns attestations for a productId', async () => {
    // Create an attestation first
    const postReq = makeRequest('POST', 'http://localhost/api/v1/attestations', VALID_ATTESTATION);
    await POST(postReq);

    const req = makeRequest('GET', 'http://localhost/api/v1/attestations?productId=prod-001');
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.attestations[0].productId).toBe('prod-001');
    expect(body.attestations[0].status).toBe('active');
  });

  it('returns attestations for an issuerAddress', async () => {
    const postReq = makeRequest('POST', 'http://localhost/api/v1/attestations', VALID_ATTESTATION);
    await POST(postReq);

    const req = makeRequest(
      'GET',
      'http://localhost/api/v1/attestations?issuerAddress=GAUDITOR123',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.total).toBe(1);
    expect(body.attestations[0].issuerAddress).toBe('GAUDITOR123');
  });

  it('returns an empty list for a product with no attestations', async () => {
    const req = makeRequest(
      'GET',
      'http://localhost/api/v1/attestations?productId=no-such-product',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attestations).toEqual([]);
    expect(body.total).toBe(0);
  });
});

// ── GET /api/v1/attestations/[id] ────────────────────────────────────────────

describe('GET /api/v1/attestations/[attestationId]', () => {
  it('returns the attestation for a known ID', async () => {
    const postReq = makeRequest('POST', 'http://localhost/api/v1/attestations', VALID_ATTESTATION);
    const postRes = await POST(postReq);
    const { attestationId } = await postRes.json();

    const req = makeRequest('GET', `http://localhost/api/v1/attestations/${attestationId}`);
    const res = await getById(req, { params: Promise.resolve({ attestationId }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.attestationId).toBe(attestationId);
  });

  it('returns 404 for an unknown attestation ID', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/attestations/att_unknown');
    const res = await getById(req, { params: Promise.resolve({ attestationId: 'att_unknown' }) });
    expect(res.status).toBe(404);
  });
});

// ── DELETE /api/v1/attestations/[id] ─────────────────────────────────────────

describe('DELETE /api/v1/attestations/[attestationId]', () => {
  it('revokes an attestation when called by the issuer', async () => {
    const postReq = makeRequest('POST', 'http://localhost/api/v1/attestations', VALID_ATTESTATION);
    const postRes = await POST(postReq);
    const { attestationId } = await postRes.json();

    const req = makeRequest(
      'DELETE',
      `http://localhost/api/v1/attestations/${attestationId}`,
      { reason: 'Audit superseded by newer report' },
      { 'x-issuer-address': 'GAUDITOR123' },
    );
    const res = await deleteById(req, { params: Promise.resolve({ attestationId }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.revoked).toBe(true);
    expect(body.attestationId).toBe(attestationId);
  });

  it('returns 400 when x-issuer-address header is missing', async () => {
    const postReq = makeRequest('POST', 'http://localhost/api/v1/attestations', VALID_ATTESTATION);
    const postRes = await POST(postReq);
    const { attestationId } = await postRes.json();

    const req = makeRequest(
      'DELETE',
      `http://localhost/api/v1/attestations/${attestationId}`,
      undefined,
      // no x-issuer-address
    );
    const res = await deleteById(req, { params: Promise.resolve({ attestationId }) });
    expect(res.status).toBe(400);
  });

  it('returns 403 when a non-issuer tries to revoke', async () => {
    const postReq = makeRequest('POST', 'http://localhost/api/v1/attestations', VALID_ATTESTATION);
    const postRes = await POST(postReq);
    const { attestationId } = await postRes.json();

    const req = makeRequest(
      'DELETE',
      `http://localhost/api/v1/attestations/${attestationId}`,
      undefined,
      { 'x-issuer-address': 'GWRONG_ISSUER' },
    );
    const res = await deleteById(req, { params: Promise.resolve({ attestationId }) });
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown attestation ID', async () => {
    const req = makeRequest(
      'DELETE',
      'http://localhost/api/v1/attestations/att_unknown',
      undefined,
      { 'x-issuer-address': 'GAUDITOR123' },
    );
    const res = await deleteById(req, {
      params: Promise.resolve({ attestationId: 'att_unknown' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns 401 without a valid API key', async () => {
    const req = makeRequest('DELETE', 'http://localhost/api/v1/attestations/att_test', undefined, {
      'x-api-key': 'wrong-key',
      'x-issuer-address': 'GAUDITOR123',
    });
    const res = await deleteById(req, { params: Promise.resolve({ attestationId: 'att_test' }) });
    expect(res.status).toBe(401);
  });
});
