/**
 * POST /api/v1/transfer-preflight
 *
 * Server-side pre-transfer compliance check. Returns whether a transfer
 * is allowed and the full list of violations/warnings.
 *
 * Body: { productId, newOwner, walletAddress? }
 *
 * Authentication: partner tier or higher
 * Rate limiting: default preset
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { getProductRepository } from '@/lib/data';
import { checkTransferCompliance } from '@/lib/transferCompliance';
import { transferPreflightBodySchema } from '@/lib/api/schemas';
import type { TransferPreflightBody } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export const runtime = 'nodejs';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/transfer-preflight',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/transfer-preflight', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/transfer-preflight', 401, Date.now() - start);
    return auth.error;
  }

  let parsed: TransferPreflightBody;
  try {
    parsed = parseJsonBody(request, await request.text(), transferPreflightBodySchema);
  } catch (error) {
    recordRequest('POST /api/v1/transfer-preflight', 400, Date.now() - start);
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_JSON, 'Invalid request'),
    );
  }

  const { productId, newOwner, walletAddress, hasPendingEscrow } = parsed;

  const product = await getProductRepository().getById(productId);
  if (!product) {
    const res = withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Product '${productId}' not found`),
    );
    recordRequest('POST /api/v1/transfer-preflight', 404, Date.now() - start);
    return res;
  }

  const result = checkTransferCompliance({
    product,
    newOwner,
    walletAddress: walletAddress ?? null,
    hasPendingEscrow,
  });

  const response = withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json(
        {
          productId,
          newOwner,
          allowed: result.allowed,
          violations: result.violations,
          blockers: result.blockers,
          warnings: result.warnings,
        },
        { status: 200 },
      ),
    ),
  );

  recordRequest('POST /api/v1/transfer-preflight', response.status, Date.now() - start);
  return response;
}
