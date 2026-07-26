/**
 * POST /api/v1/products/recall/broadcast – initiate emergency recall broadcast
 *
 * Request body:
 * {
 *   "productId": "prod-001",
 *   "reason": "Contamination detected",
 *   "severity": "critical",
 *   "stakeholders": ["GACTOR1...", "GACTOR2..."],
 *   "affectedBatches": ["batch-001"]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import {
  initiateBroadcast,
  getAllBroadcasts,
  getActiveBroadcasts,
} from '@/lib/services/recallBroadcastService';
import { getProductRepository } from '@/lib/data';
import { recordRequest } from '@/lib/api/metrics';
import { recallBroadcastBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/recall/broadcast',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/recall/broadcast', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/recall/broadcast', 401, Date.now() - start);
    return auth.error;
  }

  try {
    const body = parseJsonBody(request, await request.text(), recallBroadcastBodySchema);
    const product = getProductById(body.productId);
    if (!product) return apiError(request, 404, ErrorCode.NOT_FOUND, 'Product not found');
    const initiatedBy = request.headers.get('x-user-id') || 'system';
    const broadcast = initiateBroadcast(
      product,
      body.reason,
      body.severity,
      initiatedBy,
      body.stakeholders,
      body.affectedBatches,
    );
    recordRequest('POST /api/v1/products/recall/broadcast', 201, Date.now() - start);
    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(broadcast, { status: 201 })),
    );
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid request'),
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/products/recall/broadcast',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('GET /api/v1/products/recall/broadcast', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/products/recall/broadcast', 401, Date.now() - start);
    return auth.error;
  }

  const activeOnly = request.nextUrl.searchParams.get('active') === 'true';
  const broadcasts = activeOnly ? getActiveBroadcasts() : getAllBroadcasts();

  recordRequest('GET /api/v1/products/recall/broadcast', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json({ broadcasts }, { status: 200 })),
  );
}
