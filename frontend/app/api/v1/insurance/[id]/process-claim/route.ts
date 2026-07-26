/**
 * POST /api/v1/insurance/[id]/process-claim – automatically process a claim
 *
 * Runs the auto-approval workflow: verifies eligibility, applies threshold
 * rules, and either auto-approves, auto-rejects, or routes to manual review.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { getCoverage, processClaimAutomatically } from '@/lib/services/insuranceCoverage';
import { processClaimBodySchema } from '@/lib/api/schemas';
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
    'POST /api/v1/insurance/[id]/process-claim',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/insurance/[id]/process-claim', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('POST /api/v1/insurance/[id]/process-claim', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  const coverage = getCoverage(id);
  if (!coverage) {
    recordRequest('POST /api/v1/insurance/[id]/process-claim', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Coverage record not found: ${id}`),
    );
  }

  try {
    const { claimId } = parseJsonBody(request, await request.text(), processClaimBodySchema);
    const result = processClaimAutomatically(id, claimId);
    if (!result)
      return withCors(
        request,
        apiError(request, 404, ErrorCode.VALIDATION_ERROR, 'Claim not found'),
      );
    recordRequest('POST /api/v1/insurance/[id]/process-claim', 200, Date.now() - start);
    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(result, { status: 200 })),
    );
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid request'),
    );
  }
}
