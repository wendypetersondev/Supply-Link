/**
 * POST /api/v1/batches/[id]/recall
 *
 * Trigger a batch recall. Propagates the recall to all products in the batch.
 * Only the batch owner may trigger a recall.
 *
 * Authentication: x-api-key (partner)
 * Rate limiting: default tier
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { MOCK_BATCHES, getBatchById } from '@/lib/mock/auditors';
import { MOCK_PRODUCTS } from '@/lib/mock/products';
import { batchRecallBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/batches/[id]/recall',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/batches/[id]/recall', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/batches/[id]/recall', 401, Date.now() - start);
    return auth.error;
  }

  const { id: batchId } = await params;

  if (!batchId || typeof batchId !== 'string') {
    recordRequest('POST /api/v1/batches/[id]/recall', 400, Date.now() - start);
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid batch ID');
  }

  try {
    const body = parseJsonBody(request, await request.text(), batchRecallBodySchema);

    const batch = getBatchById(batchId);
    if (!batch) {
      recordRequest('POST /api/v1/batches/[id]/recall', 404, Date.now() - start);
      return apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Batch not found: ${batchId}`);
    }

    const reason = body.reason;
    const now = Math.floor(Date.now() / 1000);

    // Mark batch as recalled
    batch.recalled = true;
    batch.recallReason = reason;
    batch.recallTimestamp = now;

    // Propagate recall to all contained products
    let newlyRecalled = 0;
    const recalledProductIds: string[] = [];

    for (const productId of batch.productIds) {
      const product = MOCK_PRODUCTS.find((p) => p.id === productId);
      if (product && !product.recalled) {
        product.recalled = true;
        product.recallReason = reason;
        product.recallTimestamp = now;
        newlyRecalled++;
        recalledProductIds.push(productId);
      }
    }

    // TODO: Replace with Soroban contract call: recall_batch(batchId, reason)

    const responseBody = {
      batchId,
      recalled: true,
      reason,
      recallTimestamp: now,
      newlyRecalledProducts: newlyRecalled,
      recalledProductIds,
      totalProducts: batch.productIds.length,
    };

    recordRequest('POST /api/v1/batches/[id]/recall', 200, Date.now() - start);
    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(responseBody, { status: 200 })),
    );
  } catch (error) {
    const response =
      handleValidationError(request, error) ??
      apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to recall batch');
    recordRequest('POST /api/v1/batches/[id]/recall', response.status, Date.now() - start);
    return response;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/batches/[id]/recall',
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/batches/[id]/recall', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/batches/[id]/recall', 401, Date.now() - start);
    return auth.error;
  }

  const { id: batchId } = await params;

  const batch = await getAuditorRepository().getBatch(batchId);
  if (!batch) {
    recordRequest('GET /api/v1/batches/[id]/recall', 404, Date.now() - start);
    return apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Batch not found: ${batchId}`);
  }

  const recallInfo = {
    batchId,
    recalled: batch.recalled,
    reason: batch.recallReason,
    recallTimestamp: batch.recallTimestamp,
    productIds: batch.productIds,
  };

  recordRequest('GET /api/v1/batches/[id]/recall', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json(recallInfo, { status: 200 })),
  );
}
