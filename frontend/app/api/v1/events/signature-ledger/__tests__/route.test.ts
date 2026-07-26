import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from '../route';
import { NextRequest } from 'next/server';

vi.mock('@/lib/api/cors', () => ({
  withCors: (req: any, res: any) => res,
  handleOptions: () => new Response(null, { status: 200 }),
}));

vi.mock('@/lib/api/errors', () => ({
  apiError: (req: any, status: number, code: string, msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  withCorrelationId: (req: any, res: any) => res,
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR' },
}));

vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: () => null,
  RATE_LIMIT_PRESETS: { publicRead: {}, authenticated: {} },
}));

vi.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: async () => ({ error: null }),
}));

vi.mock('@/lib/api/metrics', () => ({
  recordRequest: vi.fn(),
}));

vi.mock('@/lib/data', () => ({
  getProductRepository: () => ({
    getById: async (id: string) => ({
      id,
      name: 'Test Product',
      origin: 'Test Origin',
      owner: 'GTEST',
      timestamp: 1000000,
    }),
  }),
  getEventRepository: () => ({
    listByProduct: async (id: string) => [
      {
        product_id: id,
        event_type: 'HARVEST',
        actor: 'GPRODUCER',
        timestamp: 1000000,
        location: 'Farm A',
        metadata: '{"temp":"20C"}',
      },
      {
        product_id: id,
        event_type: 'PROCESSING',
        actor: 'GPROCESSOR',
        timestamp: 1000100,
        location: 'Factory B',
        metadata: '{"batch":"001"}',
      },
    ],
  }),
}));

describe('GET /api/v1/events/signature-ledger', () => {
  it('returns 400 when productId is missing', async () => {
    const req = new NextRequest('http://localhost/api/v1/events/signature-ledger');
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it('returns signature ledger entries for valid product', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/events/signature-ledger?productId=test-prod',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.productId).toBe('test-prod');
    expect(data.entries.length).toBe(2);
    expect(data.entries[0].eventType).toBe('HARVEST');
    expect(data.entries[0].signerAddress).toBe('GPRODUCER');
    expect(data.entries[0].eventHash).toBeDefined();
  });

  it('respects pagination parameters', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/events/signature-ledger?productId=test-prod&offset=1&limit=1',
    );
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries.length).toBe(1);
    expect(data.entries[0].eventType).toBe('PROCESSING');
  });

  it('includes all required fields in ledger entries', async () => {
    const req = new NextRequest(
      'http://localhost/api/v1/events/signature-ledger?productId=test-prod',
    );
    const res = await GET(req);
    const data = await res.json();
    const entry = data.entries[0];
    expect(entry).toHaveProperty('eventIndex');
    expect(entry).toHaveProperty('productId');
    expect(entry).toHaveProperty('eventType');
    expect(entry).toHaveProperty('signerAddress');
    expect(entry).toHaveProperty('eventHash');
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('location');
  });
});
