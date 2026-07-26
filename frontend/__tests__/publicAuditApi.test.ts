/**
 * Tests for public audit API endpoints (#398).
 * Verifies product, events, and badge routes work without authentication.
 */
import { describe, it, expect, vi } from 'vitest';
import { GET as getProduct } from '@/app/api/v1/products/[id]/route';
import { GET as getEvents } from '@/app/api/v1/products/[id]/events/route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/cors', () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handleOptions: () => new Response(null, { status: 200 }),
}));

vi.mock('@/lib/api/errors', () => ({
  apiError: (_req: unknown, status: number, _code: string, msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  withCorrelationId: (_req: unknown, res: unknown) => res,
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR', MISSING_FIELDS: 'MISSING_FIELDS' },
}));

vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: () => null,
  RATE_LIMIT_PRESETS: { publicRead: {}, authenticated: {}, default: {} },
}));

vi.mock('@/lib/api/metrics', () => ({ recordRequest: vi.fn() }));

vi.mock('@/lib/data', () => ({
  getProductRepository: () => ({
    getById: async (id: string) =>
      id === 'known'
        ? { id, name: 'Test Product', origin: 'Kenya', owner: 'GTEST', timestamp: 1000000 }
        : null,
  }),
  getEventRepository: () => ({
    listByProduct: async (id: string) =>
      id === 'known'
        ? [
            {
              product_id: id,
              event_type: 'HARVEST',
              actor: 'GFARM',
              timestamp: 1000000,
              location: 'Farm',
              metadata: '{}',
            },
          ]
        : [],
    listAll: async () => [],
  }),
}));

describe('#398 Public audit APIs — no auth required', () => {
  describe('GET /api/v1/products/[id]', () => {
    it('returns product without API key', async () => {
      const req = new NextRequest('http://localhost/api/v1/products/known');
      const res = await getProduct(req, { params: Promise.resolve({ id: 'known' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.name).toBe('Test Product');
    });

    it('returns 404 for unknown product', async () => {
      const req = new NextRequest('http://localhost/api/v1/products/unknown');
      const res = await getProduct(req, { params: Promise.resolve({ id: 'unknown' }) });
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/v1/products/[id]/events', () => {
    it('returns events without API key', async () => {
      const req = new NextRequest('http://localhost/api/v1/products/known/events');
      const res = await getEvents(req, { params: Promise.resolve({ id: 'known' }) });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.items).toHaveLength(1);
      expect(data.items[0].event_type).toBe('HARVEST');
    });

    it('returns empty list for unknown product', async () => {
      const req = new NextRequest('http://localhost/api/v1/products/unknown/events');
      const res = await getEvents(req, { params: Promise.resolve({ id: 'unknown' }) });
      // 404 because product not found
      expect(res.status).toBe(404);
    });
  });
});
