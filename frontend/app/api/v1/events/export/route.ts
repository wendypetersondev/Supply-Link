/**
 * GET /api/v1/events/export?productId=<id>
 *
 * Export a product's full event history in the Supply-Link interchange format.
 *
 * Query params:
 *   productId  (required) — product to export
 *   offset     (optional) — pagination offset, default 0
 *   limit      (optional) — max events per page, default 100, max 500
 *   format     (optional) — "json" (default) | "jsonld"
 *                           Both return JSON; "jsonld" sets Content-Type to
 *                           application/ld+json for semantic consumers.
 *
 * Authentication: partner tier or higher (x-api-key)
 * Rate limiting: publicRead preset
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { getEventRepository, getProductRepository } from '@/lib/data';
import { buildInterchangePayload } from '@/lib/interchange/eventExporter';

export const runtime = 'nodejs';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/events/export',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/events/export', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/events/export', 401, Date.now() - start);
    return auth.error;
  }

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get('productId');

  if (!productId) {
    const res = withCors(
      request,
      apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'productId query parameter is required'),
    );
    recordRequest('GET /api/v1/events/export', 400, Date.now() - start);
    return res;
  }

  const offset = Math.max(0, parseInt(searchParams.get('offset') ?? '0', 10) || 0);
  const limit = Math.min(500, Math.max(1, parseInt(searchParams.get('limit') ?? '100', 10) || 100));
  const format = searchParams.get('format') ?? 'json';

  const product = await getProductRepository().getById(productId);
  if (!product) {
    const res = withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Product '${productId}' not found`),
    );
    recordRequest('GET /api/v1/events/export', 404, Date.now() - start);
    return res;
  }

  // Fetch events sorted oldest-first (canonical provenance order)
  const allEvents = (await getEventRepository().listByProduct(productId)).sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  const payload = buildInterchangePayload(product, allEvents, { offset, limit });

  const contentType = format === 'jsonld' ? 'application/ld+json' : 'application/json';

  const inner = NextResponse.json(payload, {
    status: 200,
    headers: { 'Content-Type': contentType },
  });

  const response = withCors(request, withCorrelationId(request, inner));
  recordRequest('GET /api/v1/events/export', response.status, Date.now() - start);
  return response;
}
