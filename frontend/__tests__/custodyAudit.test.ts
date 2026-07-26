import { describe, it, expect, vi } from 'vitest';
import { GET } from '@/app/api/v1/events/signature-ledger/route';
import { NextRequest } from 'next/server';
import { createHash } from 'crypto';

vi.mock('@/lib/api/cors', () => ({
  withCors: (_req: unknown, res: unknown) => res,
  handleOptions: () => new Response(null, { status: 200 }),
}));
vi.mock('@/lib/api/errors', () => ({
  apiError: (_req: unknown, status: number, _code: string, msg: string) =>
    new Response(JSON.stringify({ error: msg }), { status }),
  withCorrelationId: (_req: unknown, res: unknown) => res,
  ErrorCode: { VALIDATION_ERROR: 'VALIDATION_ERROR' },
}));
vi.mock('@/lib/api/rateLimit', () => ({
  applyRateLimit: () => null,
  RATE_LIMIT_PRESETS: { publicRead: {}, authenticated: {} },
}));
vi.mock('@/lib/api/auth', () => ({
  authenticateApiRequest: async () => ({ error: null }),
}));
vi.mock('@/lib/api/metrics', () => ({ recordRequest: vi.fn() }));
vi.mock('@/lib/data', () => ({
  getProductRepository: () => ({
    getById: async (id: string) => (id === 'p1' ? { id: 'p1' } : null),
  }),
  getEventRepository: () => ({
    listByProduct: async () => [
      {
        product_id: 'p1',
        actor: 'GA',
        event_type: 'HARVEST',
        timestamp: 1000,
        location: 'Farm',
        metadata: '{}',
      },
      {
        product_id: 'p1',
        actor: 'GB',
        event_type: 'PROCESSING',
        timestamp: 2000,
        location: 'Factory',
        metadata: '{}',
      },
      {
        product_id: 'p1',
        actor: 'GC',
        event_type: 'SHIPPING',
        timestamp: 3000,
        location: 'Port',
        metadata: '{}',
      },
    ],
  }),
}));

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

describe('#469 Chain of custody signature audit', () => {
  it('returns entries with prevHash and chainAnchor fields', async () => {
    const req = new NextRequest('http://localhost/api/v1/events/signature-ledger?productId=p1');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.entries).toHaveLength(3);
    expect(data.entries[0]).toHaveProperty('prevHash');
    expect(data.entries[0]).toHaveProperty('chainAnchor');
  });

  it('first entry prevHash is genesis (all zeros)', async () => {
    const req = new NextRequest('http://localhost/api/v1/events/signature-ledger?productId=p1');
    const res = await GET(req);
    const { entries } = await res.json();
    expect(entries[0].prevHash).toBe('0'.repeat(64));
  });

  it('each entry prevHash equals previous entry chainAnchor', async () => {
    const req = new NextRequest('http://localhost/api/v1/events/signature-ledger?productId=p1');
    const res = await GET(req);
    const { entries } = await res.json();
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].prevHash).toBe(entries[i - 1].chainAnchor);
    }
  });

  it('chainAnchor is sha256(eventHash + prevHash)', async () => {
    const req = new NextRequest('http://localhost/api/v1/events/signature-ledger?productId=p1');
    const res = await GET(req);
    const { entries } = await res.json();
    for (const e of entries) {
      const expected = sha256(e.eventHash + e.prevHash);
      expect(e.chainAnchor).toBe(expected);
    }
  });

  it('tampered eventHash breaks the chain anchor', async () => {
    const req = new NextRequest('http://localhost/api/v1/events/signature-ledger?productId=p1');
    const res = await GET(req);
    const { entries } = await res.json();

    // Simulate tampering: change eventHash of entry 1
    const tampered = [...entries];
    tampered[1] = { ...tampered[1], eventHash: 'a'.repeat(64) };

    // Recompute expected anchor for tampered entry
    const expectedAnchor = sha256(tampered[1].eventHash + tampered[1].prevHash);
    // It should differ from the original chainAnchor
    expect(expectedAnchor).not.toBe(entries[1].chainAnchor);
    // And entry 2's prevHash (which was the original anchor) no longer matches
    expect(entries[2].prevHash).not.toBe(expectedAnchor);
  });

  it('returns 404 for unknown product', async () => {
    const req = new NextRequest('http://localhost/api/v1/events/signature-ledger?productId=nope');
    const res = await GET(req);
    expect(res.status).toBe(404);
  });
});
