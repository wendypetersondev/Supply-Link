/**
 * POST  /api/v1/insurance/[id]/claims          – file a claim proof against a coverage record
 * PATCH /api/v1/insurance/[id]/claims/[claimId] – update claim proof status (verifier)
 *
 * Authentication: x-api-key (partner or internal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { insuranceClaimCreateBodySchema, insuranceClaimUpdateBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import {
  getCoverage,
  addClaimProof,
  updateClaimProofStatus,
} from '@/lib/services/insuranceCoverage';
import type { ClaimProofStatus } from '@/lib/services/insuranceCoverage';

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
    'POST /api/v1/insurance/[id]/claims',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/insurance/[id]/claims', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/insurance/[id]/claims', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  const coverage = getCoverage(id);
  if (!coverage) {
    recordRequest('POST /api/v1/insurance/[id]/claims', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Coverage record not found: ${id}`),
    );
  }

  let body;
  try {
    body = parseJsonBody(request, await request.text(), insuranceClaimCreateBodySchema);
  } catch (error) {
    recordRequest('POST /api/v1/insurance/[id]/claims', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  const proof = addClaimProof({ coverageId: id, ...body });
  if (!proof) {
    return withCors(
      request,
      apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to add claim proof'),
    );
  }

  recordRequest('POST /api/v1/insurance/[id]/claims', 201, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(proof, { status: 201 })));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('PATCH /api/v1/insurance/[id]/claims', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  let body;
  try {
    body = parseJsonBody(request, await request.text(), insuranceClaimUpdateBodySchema);
  } catch (error) {
    recordRequest('PATCH /api/v1/insurance/[id]/claims', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  const updated = updateClaimProofStatus(
    id,
    body.claimId,
    body.status as ClaimProofStatus,
    body.verifierNotes,
  );

  if (!updated) {
    recordRequest('PATCH /api/v1/insurance/[id]/claims', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, 'Coverage or claim not found'),
    );
  }

  recordRequest('PATCH /api/v1/insurance/[id]/claims', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(updated, { status: 200 })));
}
