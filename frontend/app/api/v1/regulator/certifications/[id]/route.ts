/**
 * GET    /api/v1/regulator/certifications/[id]  — get a single certification
 * DELETE /api/v1/regulator/certifications/[id]  — revoke a certification
 *
 * closes #482
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { recordRequest } from '@/lib/api/metrics';
import { regulatorCertificationRevokeBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import {
  getCertification,
  revokeCertification,
  effectiveStatus,
} from '@/lib/regulator/certifications';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const { id } = await params;

  const limited = applyRateLimit(
    request,
    'GET /api/v1/regulator/certifications/[id]',
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/regulator/certifications/[id]', 429, Date.now() - start);
    return limited;
  }

  const cert = getCertification(id);
  if (!cert) {
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, 'Certification not found'),
    );
  }

  const res = NextResponse.json(
    { certification: { ...cert, effectiveStatus: effectiveStatus(cert) } },
    { status: 200 },
  );
  recordRequest('GET /api/v1/regulator/certifications/[id]', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, res));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const { id } = await params;

  const limited = applyRateLimit(
    request,
    'DELETE /api/v1/regulator/certifications/[id]',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('DELETE /api/v1/regulator/certifications/[id]', 429, Date.now() - start);
    return limited;
  }

  try {
    const { actor, note } = parseJsonBody(
      request,
      await request.text(),
      regulatorCertificationRevokeBodySchema,
    );
    const revoked = revokeCertification(id, actor, note);
    if (!revoked) {
      const existing = getCertification(id);
      if (!existing)
        return withCors(
          request,
          apiError(request, 404, ErrorCode.VALIDATION_ERROR, 'Certification not found'),
        );
      return withCors(
        request,
        apiError(request, 409, ErrorCode.IDEMPOTENCY_CONFLICT, 'Certification is already revoked'),
      );
    }
    const res = NextResponse.json({ certification: revoked }, { status: 200 });
    recordRequest('DELETE /api/v1/regulator/certifications/[id]', 200, Date.now() - start);
    return withCors(request, withCorrelationId(request, res));
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_JSON, 'Invalid request'),
    );
  }
}
