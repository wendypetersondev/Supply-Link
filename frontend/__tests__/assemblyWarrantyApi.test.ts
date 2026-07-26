/**
 * Tests for assembly and warranty REST API routes.
 *
 * Uses the same pattern as existing API tests in this project:
 * mock auth + rate-limit middleware, then call the route handler directly.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── Shared middleware mocks ───────────────────────────────────────────────────

vi.mock('@/lib/api/cors', () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handleOptions: () => new Response(null, { status: 204 }),
}));

vi.mock('@/lib/api/errors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/errors')>();
  return {
    ...actual,
    withCorrelationId: (_req: unknown, res: unknown) => res,
  };
});

vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: () => null,
  RATE_LIMIT_PRESETS: { default: {}, publicRead: {}, authenticated: {} },
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: () => Promise.resolve({ apiKey: 'test-key', error: null }),
}));

vi.mock('@/lib/api/idempotency', () => ({
  withIdempotency: (_req: NextRequest, fn: (req: NextRequest, body: string) => unknown) =>
    _req.text().then((body) => fn(_req, body)),
}));

vi.mock('@/lib/api/metrics', () => ({
  recordRequest: vi.fn(),
}));

// ── Mock products store ───────────────────────────────────────────────────────

import type { Product } from '@/lib/types';

const mockProducts: Product[] = [
  {
    id: 'prod-001',
    name: 'Coffee Beans',
    origin: 'Ethiopia',
    owner: 'GOWNER123',
    timestamp: 1710000000000,
    active: true,
    authorizedActors: [],
    warranty: {
      productId: 'prod-001',
      durationSeconds: 2 * 365 * 24 * 3600,
      issuer: 'GOWNER123',
      issuedAt: 1710000000000,
      terms: 'Quality guarantee',
      termsRef: 'ipfs://QmDoc',
      voided: false,
      voidedAt: 0,
    },
    warrantyClaims: [],
  },
  {
    id: 'prod-002',
    name: 'Cocoa',
    origin: 'Ghana',
    owner: 'GOWNER456',
    timestamp: 1711000000000,
    active: true,
    authorizedActors: [],
  },
  {
    id: 'prod-003',
    name: 'Chocolate Bar',
    origin: 'Belgium',
    owner: 'GOWNER123',
    timestamp: 1712000000000,
    active: true,
    authorizedActors: [],
    assembly: {
      parentId: 'prod-003',
      componentIds: ['prod-001', 'prod-002'],
      registeredBy: 'GOWNER123',
      registeredAt: 1712100000000,
      description: 'Assembled product',
    },
  },
];

vi.mock('@/lib/data', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data')>();
  // `products` is a getter: this factory runs before the const above is
  // initialised, so the array can only be read lazily.
  const store: import('@/lib/data').MockStore = {
    ...actual.createMockStore(),
    get products() {
      return mockProducts;
    },
  };
  const productRepository = new actual.MockProductRepository(store);
  return { ...actual, getProductRepository: () => productRepository };
});

// ── Import route handlers ─────────────────────────────────────────────────────

import {
  GET as getAssembly,
  POST as postAssembly,
} from '@/app/api/v1/products/[id]/assembly/route';
import {
  GET as getWarranty,
  POST as postWarranty,
} from '@/app/api/v1/products/[id]/warranty/route';
import {
  GET as getClaims,
  POST as postClaim,
} from '@/app/api/v1/products/[id]/warranty/claims/route';

function makeRequest(method: string, url: string, body?: object): NextRequest {
  return new NextRequest(url, {
    method,
    headers: { 'content-type': 'application/json', 'x-api-key': 'test-key' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// ── Assembly GET ──────────────────────────────────────────────────────────────

describe('GET /api/v1/products/[id]/assembly', () => {
  it('returns assembly for product with assembly', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/products/prod-003/assembly');
    const res = await getAssembly(req, { params: Promise.resolve({ id: 'prod-003' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.assembly.parentId).toBe('prod-003');
    expect(data.assembly.componentIds).toEqual(['prod-001', 'prod-002']);
  });

  it('returns null assembly for product without assembly', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/products/prod-001/assembly');
    const res = await getAssembly(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.assembly).toBeNull();
  });

  it('returns 404 for unknown product', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/products/unknown/assembly');
    const res = await getAssembly(req, { params: Promise.resolve({ id: 'unknown' }) });
    expect(res.status).toBe(404);
  });
});

// ── Assembly POST ─────────────────────────────────────────────────────────────

describe('POST /api/v1/products/[id]/assembly', () => {
  it('registers assembly with valid payload', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-001/assembly', {
      componentIds: ['prod-002'],
      description: 'Test assembly',
      registeredBy: 'GOWNER123',
    });
    const res = await postAssembly(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.assembly.parentId).toBe('prod-001');
    expect(data.assembly.componentIds).toEqual(['prod-002']);
  });

  it('returns 400 when componentIds is empty', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-001/assembly', {
      componentIds: [],
    });
    const res = await postAssembly(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when componentIds is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-001/assembly', {
      description: 'No components',
    });
    const res = await postAssembly(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when a component product does not exist', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-001/assembly', {
      componentIds: ['nonexistent-product'],
    });
    const res = await postAssembly(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when componentIds exceeds 50', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-001/assembly', {
      componentIds: Array.from({ length: 51 }, (_, i) => `comp-${i}`),
    });
    const res = await postAssembly(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown parent product', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/unknown/assembly', {
      componentIds: ['prod-001'],
    });
    const res = await postAssembly(req, { params: Promise.resolve({ id: 'unknown' }) });
    expect(res.status).toBe(404);
  });
});

// ── Warranty GET ──────────────────────────────────────────────────────────────

describe('GET /api/v1/products/[id]/warranty', () => {
  it('returns warranty for product with warranty', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/products/prod-001/warranty');
    const res = await getWarranty(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warranty.productId).toBe('prod-001');
    expect(data.warranty.terms).toBe('Quality guarantee');
  });

  it('returns null warranty for product without warranty', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/products/prod-002/warranty');
    const res = await getWarranty(req, { params: Promise.resolve({ id: 'prod-002' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.warranty).toBeNull();
  });

  it('returns 404 for unknown product', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/products/unknown/warranty');
    const res = await getWarranty(req, { params: Promise.resolve({ id: 'unknown' }) });
    expect(res.status).toBe(404);
  });
});

// ── Warranty POST ─────────────────────────────────────────────────────────────

describe('POST /api/v1/products/[id]/warranty', () => {
  it('registers warranty with valid payload', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-002/warranty', {
      durationSeconds: 365 * 24 * 3600,
      terms: '1-year warranty',
      termsRef: 'ipfs://QmDoc',
      issuer: 'GOWNER456',
    });
    const res = await postWarranty(req, { params: Promise.resolve({ id: 'prod-002' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.warranty.productId).toBe('prod-002');
    expect(data.warranty.voided).toBe(false);
  });

  it('registers lifetime warranty when durationSeconds is 0', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-002/warranty', {
      durationSeconds: 0,
      terms: 'Lifetime warranty',
      termsRef: '',
      issuer: 'GOWNER456',
    });
    const res = await postWarranty(req, { params: Promise.resolve({ id: 'prod-002' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.warranty.durationSeconds).toBe(0);
  });

  it('returns 400 when durationSeconds is negative', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-002/warranty', {
      durationSeconds: -1,
    });
    const res = await postWarranty(req, { params: Promise.resolve({ id: 'prod-002' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when terms exceeds 1024 characters', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-002/warranty', {
      durationSeconds: 0,
      terms: 'x'.repeat(1025),
    });
    const res = await postWarranty(req, { params: Promise.resolve({ id: 'prod-002' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown product', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/unknown/warranty', {
      durationSeconds: 0,
    });
    const res = await postWarranty(req, { params: Promise.resolve({ id: 'unknown' }) });
    expect(res.status).toBe(404);
  });
});

// ── Claims GET ────────────────────────────────────────────────────────────────

describe('GET /api/v1/products/[id]/warranty/claims', () => {
  it('returns empty claims list for product with no claims', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/products/prod-001/warranty/claims');
    const res = await getClaims(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('returns 404 for unknown product', async () => {
    const req = makeRequest('GET', 'http://localhost/api/v1/products/unknown/warranty/claims');
    const res = await getClaims(req, { params: Promise.resolve({ id: 'unknown' }) });
    expect(res.status).toBe(404);
  });
});

// ── Claims POST ───────────────────────────────────────────────────────────────

describe('POST /api/v1/products/[id]/warranty/claims', () => {
  it('files a claim with valid payload', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-001/warranty/claims', {
      description: 'Product defective on arrival',
      claimant: 'GCUSTOMER123',
      proofRef: 'ipfs://QmProof',
    });
    const res = await postClaim(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(201);
    const data = await res.json();
    expect(data.status).toBe('Pending');
    expect(data.description).toBe('Product defective on arrival');
    expect(data.claimId).toBeTruthy();
  });

  it('returns 400 when description is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-001/warranty/claims', {
      claimant: 'GCUSTOMER123',
    });
    const res = await postClaim(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when claimant is missing', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-001/warranty/claims', {
      description: 'Broken',
    });
    const res = await postClaim(req, { params: Promise.resolve({ id: 'prod-001' }) });
    expect(res.status).toBe(400);
  });

  it('returns 400 when product has no warranty', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/prod-002/warranty/claims', {
      description: 'Broken',
      claimant: 'GCUSTOMER123',
    });
    const res = await postClaim(req, { params: Promise.resolve({ id: 'prod-002' }) });
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown product', async () => {
    const req = makeRequest('POST', 'http://localhost/api/v1/products/unknown/warranty/claims', {
      description: 'Broken',
      claimant: 'GCUSTOMER123',
    });
    const res = await postClaim(req, { params: Promise.resolve({ id: 'unknown' }) });
    expect(res.status).toBe(404);
  });
});
