/**
 * GET  /api/v1/products/[id]/warranty  – get warranty info for a product
 * POST /api/v1/products/[id]/warranty  – register warranty metadata
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
import { warrantyBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import type { WarrantyInfo } from '@/lib/types';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

async function getWarranty(req: NextRequest, productId: string): Promise<NextResponse> {
  const product = await getProductRepository().getById(productId);
  if (!product) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${productId}`);
  }
  return withCors(
    req,
    withCorrelationId(
      req,
      NextResponse.json({ warranty: product.warranty ?? null }, { status: 200 }),
    ),
  );
}

async function registerWarranty(
  req: NextRequest,
  productId: string,
  rawBody: string,
): Promise<NextResponse> {
  const product = await getProductRepository().getById(productId);
  if (!product) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${productId}`);
  }

  let body;
  try {
    body = parseJsonBody(req, rawBody, warrantyBodySchema);
  } catch (error) {
    return (
      handleValidationError(req, error) ??
      apiError(req, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid JSON')
    );
  }

  const warranty: WarrantyInfo = {
    productId,
    durationSeconds: body.durationSeconds,
    issuer: body.issuer,
    issuedAt: Date.now(),
    terms: body.terms,
    termsRef: body.termsRef,
    voided: false,
    voidedAt: 0,
  };

  await getProductRepository().setWarranty(productId, warranty);

  return withCors(req, withCorrelationId(req, NextResponse.json({ warranty }, { status: 201 })));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const limited = applyRateLimit(
    request,
    'GET /api/v1/products/[id]/warranty',
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/products/[id]/warranty', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/products/[id]/warranty', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  if (!id) return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');

  const response = await getWarranty(request, id);
  recordRequest('GET /api/v1/products/[id]/warranty', response.status, Date.now() - start);
  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/[id]/warranty',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/[id]/warranty', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/[id]/warranty', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  if (!id) return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');

  const response = await withIdempotency(request, (req, rawBody) =>
    registerWarranty(req, id, rawBody),
  );
  recordRequest('POST /api/v1/products/[id]/warranty', response.status, Date.now() - start);
  return response;
}
