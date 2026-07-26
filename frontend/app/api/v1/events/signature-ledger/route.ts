/**
 * GET /api/v1/events/signature-ledger?productId=<id>
 *
 * Export a product's chain-of-custody signature ledger for audit purposes.
 * Each entry includes a SHA-256 event hash and a prevHash anchor that chains
 * entries together — any tampering breaks the hash chain.
 *
 * Query params:
 *   productId  (required)
 *   offset     (optional, default 0)
 *   limit      (optional, default 100, max 500)
 *
 * Authentication: partner tier or higher (x-api-key)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { getEventRepository, getProductRepository } from '@/lib/data';
import { createHash } from 'crypto';

export const runtime = 'nodejs';

export interface CustodyEntry {
  eventIndex: number;
  productId: string;
  eventType: string;
  signerAddress: string;
  eventHash: string;
  /** SHA-256 of the previous entry's eventHash, or '0'.repeat(64) for the first entry. */
  prevHash: string;
  /** SHA-256(eventHash + prevHash) — the chain anchor for this entry. */
  chainAnchor: string;
  timestamp: number;
  location: string;
}

export interface SignatureLedgerResponse {
  productId: string;
  totalEvents: number;
  offset: number;
  limit: number;
  entries: CustodyEntry[];
  exportedAt: string;
}

const GENESIS_HASH = '0'.repeat(64);

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hashEvent(
  productId: string,
  actor: string,
  eventType: string,
  timestamp: number,
  metadata: string,
): string {
  return sha256(`${productId}|${actor}|${eventType}|${timestamp}|${metadata}`);
}

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/events/signature-ledger',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/events/signature-ledger', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/events/signature-ledger', 401, Date.now() - start);
    return auth.error;
  }

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get('productId');

  if (!productId) {
    const res = withCors(
      request,
      apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'productId query parameter is required'),
    );
    recordRequest('GET /api/v1/events/signature-ledger', 400, Date.now() - start);
    return res;
  }

  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10) || 100));

  const product = await getProductRepository().getById(productId);
  if (!product) {
    const res = withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Product '${productId}' not found`),
    );
    recordRequest('GET /api/v1/events/signature-ledger', 404, Date.now() - start);
    return res;
  }

  const allEvents = (await getEventRepository().listByProduct(productId)).sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const page = allEvents.slice(offset, offset + limit);

  // Build the hash chain. For paginated requests we need the anchor of the
  // entry just before the page window so the chain is continuous.
  let prevHash = GENESIS_HASH;
  if (offset > 0) {
    // Recompute chain up to offset to get the correct prevHash
    for (let i = 0; i < offset && i < allEvents.length; i++) {
      const e = allEvents[i];
      const eventHash = hashEvent(e.productId, e.actor, e.eventType, e.timestamp, e.metadata);
      const chainAnchor = sha256(eventHash + prevHash);
      prevHash = chainAnchor;
    }
  }

  const entries: CustodyEntry[] = page.map((event, idx) => {
    const eventHash = hashEvent(
      event.productId,
      event.actor,
      event.eventType,
      event.timestamp,
      event.metadata,
    );
    const chainAnchor = sha256(eventHash + prevHash);
    const entry: CustodyEntry = {
      eventIndex: offset + idx,
      productId: event.productId,
      eventType: event.eventType,
      signerAddress: event.actor,
      eventHash,
      prevHash,
      chainAnchor,
      timestamp: event.timestamp,
      location: event.location,
    };
    prevHash = chainAnchor;
    return entry;
  });

  const payload: SignatureLedgerResponse = {
    productId,
    totalEvents: allEvents.length,
    offset,
    limit,
    entries,
    exportedAt: new Date().toISOString(),
  };

  const inner = NextResponse.json(payload, { status: 200 });
  const response = withCors(request, withCorrelationId(request, inner));
  recordRequest('GET /api/v1/events/signature-ledger', response.status, Date.now() - start);
  return response;
}
