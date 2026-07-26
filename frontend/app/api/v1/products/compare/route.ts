/**
 * POST /api/v1/products/compare – compare multiple products across supply chain
 *
 * Request body:
 * {
 *   "productIds": ["prod-001", "prod-002"]
 * }
 *
 * Response:
 * {
 *   "products": [
 *     {
 *       "productId": "prod-001",
 *       "name": "Organic Coffee",
 *       "metrics": { ... },
 *       "commonActors": [...],
 *       "commonLocations": [...]
 *     }
 *   ],
 *   "networkTrustSignals": {
 *     "sharedActors": { "actor1": 2, ... },
 *     "sharedLocations": { "location1": 2, ... },
 *     "trustPathStrength": 75.5
 *   }
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { productCompareBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { compareProducts } from '@/lib/services/comparisonService';
import { getEventRepository, getProductRepository } from '@/lib/data';
import { recordRequest } from '@/lib/api/metrics';
import type { Product } from '@/lib/types';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/compare',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/compare', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/compare', 401, Date.now() - start);
    return auth.error;
  }

  try {
    const body = parseJsonBody(request, await request.text(), productCompareBodySchema);
    const productIds = body.productIds;
    const products = productIds.map((id) => getProductById(id)).filter((p) => p !== undefined);

    if (products.length < 2) {
      return apiError(
        request,
        400,
        ErrorCode.VALIDATION_ERROR,
        'At least 2 valid products required',
      );
    }

    const result = compareProducts(products, MOCK_EVENTS);
    const response = {
      products: result.products,
      networkTrustSignals: {
        sharedActors: Object.fromEntries(result.networkTrustSignals.sharedActors),
        sharedLocations: Object.fromEntries(result.networkTrustSignals.sharedLocations),
        trustPathStrength: result.networkTrustSignals.trustPathStrength,
      },
    };
    recordRequest('POST /api/v1/products/compare', 200, Date.now() - start);
    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(response, { status: 200 })),
    );
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid request'),
    );
  }
}
