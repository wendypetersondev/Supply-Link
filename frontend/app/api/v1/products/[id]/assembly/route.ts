/**
 * GET  /api/v1/products/[id]/assembly  – get assembly record for a product
 * POST /api/v1/products/[id]/assembly  – register/update assembly relationship
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
import { productAssemblyBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import type { ProductAssembly } from '@/lib/types';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

async function getAssembly(req: NextRequest, productId: string): Promise<NextResponse> {
  const product = getProductById(productId);
  if (!product) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${productId}`);
  }

  if (!product.assembly) {
    return withCors(
      req,
      withCorrelationId(req, NextResponse.json({ assembly: null }, { status: 200 })),
    );
  }

  return withCors(
    req,
    withCorrelationId(req, NextResponse.json({ assembly: product.assembly }, { status: 200 })),
  );
}

async function registerAssembly(
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
    body = parseJsonBody(req, rawBody, productAssemblyBodySchema);
  } catch (error) {
    return (
      handleValidationError(req, error) ??
      apiError(req, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid JSON')
    );
  }

  // Validate all component products exist
  for (const cid of body.componentIds) {
    if (!getProductById(cid)) {
      return apiError(req, 400, ErrorCode.VALIDATION_ERROR, `Component product not found: ${cid}`);
    }
  }

  const assembly: ProductAssembly = {
    parentId: productId,
    componentIds: body.componentIds,
    registeredBy: body.registeredBy,
    registeredAt: Date.now(),
    description: body.description,
  };

  await productRepository.setAssembly(productId, assembly);

  return withCors(req, withCorrelationId(req, NextResponse.json({ assembly }, { status: 201 })));
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const limited = applyRateLimit(
    request,
    'GET /api/v1/products/[id]/assembly',
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/products/[id]/assembly', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/products/[id]/assembly', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  if (!id) return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');

  const response = await getAssembly(request, id);
  recordRequest('GET /api/v1/products/[id]/assembly', response.status, Date.now() - start);
  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/[id]/assembly',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/[id]/assembly', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/[id]/assembly', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  if (!id) return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');

  const response = await withIdempotency(request, (req, rawBody) =>
    registerAssembly(req, id, rawBody),
  );
  recordRequest('POST /api/v1/products/[id]/assembly', response.status, Date.now() - start);
  return response;
}
