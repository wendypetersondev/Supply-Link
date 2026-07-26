/**
 * GET /api/v1/products/saved-queries – list saved queries for user
 * POST /api/v1/products/saved-queries – save a new query
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { saveQuery, getSavedQueries } from '@/lib/services/searchService';
import { recordRequest } from '@/lib/api/metrics';
import { savedQueryBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/products/saved-queries',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('GET /api/v1/products/saved-queries', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/products/saved-queries', 401, Date.now() - start);
    return auth.error;
  }

  // Extract user ID from auth context (would come from JWT in production)
  const userId = request.headers.get('x-user-id') || 'default-user';
  const queries = getSavedQueries(userId);

  recordRequest('GET /api/v1/products/saved-queries', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json({ queries }, { status: 200 })),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/saved-queries',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/saved-queries', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/saved-queries', 401, Date.now() - start);
    return auth.error;
  }

  try {
    const body = parseJsonBody(request, await request.text(), savedQueryBodySchema);
    const userId = request.headers.get('x-user-id') || 'default-user';
    const saved = saveQuery(userId, body.name, body.query);
    recordRequest('POST /api/v1/products/saved-queries', 201, Date.now() - start);
    return withCors(request, withCorrelationId(request, NextResponse.json(saved, { status: 201 })));
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid request'),
    );
  }
}
