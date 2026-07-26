/**
 * GET /api/v1/products/[id]/scorecard
 *
 * Generate a traceability scorecard for compliance reporting.
 * Returns metrics on supply chain completeness and compliance coverage.
 *
 * Authentication: internal tier (x-api-key)
 * Rate limiting: publicRead preset
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { getEventRepository, getProductRepository } from '@/lib/data';
import { calculateTraceabilityScore } from '@/lib/compliance/traceabilityScorecard';

export const runtime = 'nodejs';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const { id: productId } = await params;

  const limited = applyRateLimit(
    request,
    `GET /api/v1/products/${productId}/scorecard`,
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest(`GET /api/v1/products/${productId}/scorecard`, 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest(`GET /api/v1/products/${productId}/scorecard`, 401, Date.now() - start);
    return auth.error;
  }

  const product = await getProductRepository().getById(productId);
  if (!product) {
    const res = withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Product '${productId}' not found`),
    );
    recordRequest(`GET /api/v1/products/${productId}/scorecard`, 404, Date.now() - start);
    return res;
  }

  const events = await getEventRepository().listByProduct(productId);
  const scorecard = calculateTraceabilityScore(productId, events);

  const inner = NextResponse.json(scorecard, { status: 200 });
  const response = withCors(request, withCorrelationId(request, inner));
  recordRequest(`GET /api/v1/products/${productId}/scorecard`, response.status, Date.now() - start);
  return response;
}
