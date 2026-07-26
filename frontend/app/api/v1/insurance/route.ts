/**
 * GET  /api/v1/insurance        – list coverage for a product
 * POST /api/v1/insurance        – add insurance coverage to a product
 *
 * Authentication: x-api-key (partner or internal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { withCorrelationId } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { insuranceCoverageBodySchema, insuranceListQuerySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody, parseQuery } from '@/lib/api/validation';
import {
  addCoverage,
  listCoverageForProduct,
  verifyCoverage,
} from '@/lib/services/insuranceCoverage';
import { recordReadAccess, anonymousActor } from '@/lib/services/readAccessAudit';
import { getCorrelationId } from '@/lib/api/correlation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/insurance',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/insurance', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/insurance', 401, Date.now() - start);
    return auth.error;
  }

  let query;
  try {
    query = parseQuery(request, insuranceListQuerySchema);
  } catch (error) {
    recordRequest('GET /api/v1/insurance', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  // Audit the read access
  recordReadAccess({
    operation: 'insurance.read',
    productIds: [query.productId],
    actor: anonymousActor(),
    requestPath: request.nextUrl.pathname,
    responseStatus: 200,
    correlationId: getCorrelationId(request),
  });

  const coverages = listCoverageForProduct(query.productId);
  const verification = verifyCoverage(query.productId);

  recordRequest('GET /api/v1/insurance', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ coverages, verification, total: coverages.length }, { status: 200 }),
    ),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/insurance',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/insurance', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('POST /api/v1/insurance', 401, Date.now() - start);
    return auth.error;
  }

  let body;
  try {
    body = parseJsonBody(request, await request.text(), insuranceCoverageBodySchema);
  } catch (error) {
    recordRequest('POST /api/v1/insurance', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  const coverage = addCoverage(body);

  recordRequest('POST /api/v1/insurance', 201, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json(coverage, { status: 201 })),
  );
}
