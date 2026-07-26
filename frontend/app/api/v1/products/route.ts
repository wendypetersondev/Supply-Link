/**
 * GET  /api/v1/products     – list all products (paginated)
 * POST /api/v1/products     – register a new product
 *
 * Authentication: partner tier (registry-based API key)
 * Rate limiting: default preset
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
import { productCreateBodySchema, productListQuerySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody, parseQuery } from '@/lib/api/validation';
import type { Product, PaginatedResponse } from '@/lib/types';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

async function listProducts(req: NextRequest, apiKey: string): Promise<NextResponse> {
  const { offset, limit } = parseQuery(req, productListQuerySchema);

  const page = await getProductRepository().list({ offset, limit });

  const response: PaginatedResponse<Product> = {
    items: page.items,
    total: page.total,
    offset,
    limit,
  };

  return withCors(req, withCorrelationId(req, NextResponse.json(response, { status: 200 })));
}

async function registerProduct(
  req: NextRequest,
  apiKey: string,
  rawBody: string,
): Promise<NextResponse> {
  try {
    const body = parseJsonBody(req, rawBody, productCreateBodySchema);

    // Create new product
    const newProduct: Product = {
      id: `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: body.name,
      origin: body.origin,
      owner: body.owner,
      timestamp: Date.now(),
      active: true,
      authorizedActors: body.authorizedActors,
      requiredSignatures: body.requiredSignatures,
      imageUrl: body.imageUrl,
      ownershipHistory: [
        {
          owner: body.owner,
          transferredAt: Date.now(),
        },
      ],
    };

    // TODO: Persist to database instead of mock
    MOCK_PRODUCTS.push(newProduct);

    // Notify webhooks of the new product registration
    try {
      const { notifyWebhooksOfProductEvent } = await import('@/lib/webhooks/processor');
      await notifyWebhooksOfProductEvent('product_registered', newProduct.id, {
        product: newProduct,
      });
    } catch (err) {
      console.error('Failed to notify webhooks of product registration:', err);
      // Don't fail the request if webhook notification fails
    }

    return withCors(req, withCorrelationId(req, NextResponse.json(newProduct, { status: 201 })));
  } catch (error) {
    return (
      handleValidationError(req, error) ??
      apiError(req, 500, ErrorCode.INTERNAL_ERROR, 'Failed to register product')
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  // Apply IP-based rate limiting (public endpoint behavior)
  const limited = applyRateLimit(request, 'GET /api/v1/products', RATE_LIMIT_PRESETS.default);
  if (limited) {
    recordRequest('GET /api/v1/products', 429, Date.now() - start);
    return limited;
  }

  // Authenticate API key
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/products', 401, Date.now() - start);
    return auth.error;
  }

  let response: NextResponse;
  try {
    response = await listProducts(request, auth.apiKey!);
  } catch (error) {
    response =
      handleValidationError(request, error) ??
      apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to list products');
  }
  recordRequest('GET /api/v1/products', response.status, Date.now() - start);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  // Apply IP-based rate limiting
  const limited = applyRateLimit(request, 'POST /api/v1/products', RATE_LIMIT_PRESETS.default);
  if (limited) {
    recordRequest('POST /api/v1/products', 429, Date.now() - start);
    return limited;
  }

  // Authenticate API key
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products', 401, Date.now() - start);
    return auth.error;
  }

  // Handle with idempotency
  const response = await withIdempotency(request, (req, rawBody) =>
    registerProduct(req, auth.apiKey!, rawBody),
  );

  recordRequest('POST /api/v1/products', response.status, Date.now() - start);
  return response;
}
