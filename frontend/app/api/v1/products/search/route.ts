/**
 * POST /api/v1/products/search – search and filter products
 *
 * Request body:
 * {
 *   "text": "coffee",
 *   "filters": {
 *     "category": "agricultural",
 *     "status": "active"
 *   },
 *   "offset": 0,
 *   "limit": 50
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { searchProducts } from '@/lib/services/searchService';
import { getProductRepository } from '@/lib/data';
import { recordRequest } from '@/lib/api/metrics';
import { productSearchBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/search',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/search', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/search', 401, Date.now() - start);
    return auth.error;
  }

  try {
    const query = parseJsonBody(request, await request.text(), productSearchBodySchema);
    const result = searchProducts(getAllProducts(), query);
    recordRequest('POST /api/v1/products/search', 200, Date.now() - start);
    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(result, { status: 200 })),
    );
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid request'),
    );
  }
}
