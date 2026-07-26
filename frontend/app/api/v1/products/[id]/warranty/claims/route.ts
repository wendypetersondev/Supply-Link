/**
 * GET  /api/v1/products/[id]/warranty/claims  – list warranty claims
 * POST /api/v1/products/[id]/warranty/claims  – file a new warranty claim
 *
 * Authentication: x-api-key (partner or internal)
 * Rate limiting: partner tier
 * Idempotency: POST requests via Idempotency-Key header
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { withIdempotency } from '@/lib/api/idempotency';
import { getProductRepository } from '@/lib/data';
import { recordRequest } from '@/lib/api/metrics';
import { paginationQuerySchema, warrantyClaimBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody, parseQuery } from '@/lib/api/validation';
import type { WarrantyClaim, PaginatedResponse } from '@/lib/types';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

async function listClaims(req: NextRequest, productId: string): Promise<NextResponse> {
  const product = await getProductRepository().getById(productId);
  if (!product) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${productId}`);
  }

  let query;
  try {
    query = parseQuery(req, paginationQuerySchema);
  } catch (error) {
    return (
      handleValidationError(req, error) ??
      apiError(req, 400, ErrorCode.VALIDATION_ERROR, 'Request validation failed')
    );
  }

  const allClaims = product.warrantyClaims ?? [];
  const items = allClaims.slice(query.offset, query.offset + query.limit);

  const response: PaginatedResponse<WarrantyClaim> = {
    items,
    total: allClaims.length,
    offset: query.offset,
    limit: query.limit,
  };

  return withCors(req, withCorrelationId(req, NextResponse.json(response, { status: 200 })));
}

async function fileClaim(
  req: NextRequest,
  productId: string,
  rawBody: string,
): Promise<NextResponse> {
  const product = await getProductRepository().getById(productId);
  if (!product) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${productId}`);
  }

  if (!product.warranty) {
    return apiError(
      req,
      400,
      ErrorCode.VALIDATION_ERROR,
      'No warranty registered for this product',
    );
  }

  if (product.warranty.voided) {
    return apiError(req, 400, ErrorCode.VALIDATION_ERROR, 'Warranty has been voided');
  }

  let body;
  try {
    body = parseJsonBody(req, rawBody, warrantyClaimBodySchema);
  } catch (error) {
    return (
      handleValidationError(req, error) ??
      apiError(req, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid JSON')
    );
  }

  const claim: WarrantyClaim = {
    claimId: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    productId,
    claimant: body.claimant,
    filedAt: Date.now(),
    description: body.description,
    proofRef: body.proofRef,
    status: 'Pending',
    updatedAt: Date.now(),
  };

  await getProductRepository().addWarrantyClaim(productId, claim);

  return withCors(req, withCorrelationId(req, NextResponse.json(claim, { status: 201 })));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const limited = applyRateLimit(
    request,
    'GET /api/v1/products/[id]/warranty/claims',
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/products/[id]/warranty/claims', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/products/[id]/warranty/claims', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  if (!id) return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');

  const response = await listClaims(request, id);
  recordRequest('GET /api/v1/products/[id]/warranty/claims', response.status, Date.now() - start);
  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/[id]/warranty/claims',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/[id]/warranty/claims', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/[id]/warranty/claims', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  if (!id) return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');

  const response = await withIdempotency(request, (req, rawBody) => fileClaim(req, id, rawBody));
  recordRequest('POST /api/v1/products/[id]/warranty/claims', response.status, Date.now() - start);
  return response;
}
