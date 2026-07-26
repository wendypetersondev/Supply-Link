/**
 * GET /api/v1/products/[id]/events/sequence
 *
 * Returns the current event sequence state for a product.
 * Clients must fetch this before submitting a new event and include
 * the returned `nextSeq` value in their POST body as `seq`.
 *
 * Authentication: x-api-key (partner)
 */
import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { authenticateApiRequest } from '@/lib/api/auth';
import { getEventSequence } from '@/lib/api/eventSequence';
import { getProductRepository } from '@/lib/data';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!id || typeof id !== 'string') {
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');
  }

  const product = await getProductRepository().getById(id);
  if (!product) {
    return apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${id}`);
  }

  const sequence = await getEventSequence(id);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json(sequence, { status: 200 })),
  );
}
