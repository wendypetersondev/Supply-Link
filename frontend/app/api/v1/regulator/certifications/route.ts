/**
 * POST /api/v1/regulator/certifications  — issue a regulator certification
 * GET  /api/v1/regulator/certifications  — list certifications (filter by productId or issuer)
 *
 * closes #482
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { recordRequest } from '@/lib/api/metrics';
import { regulatorCertificationBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import {
  issueCertification,
  listCertifications,
  listByIssuer,
  effectiveStatus,
} from '@/lib/regulator/certifications';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/regulator/certifications',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/regulator/certifications', 429, Date.now() - start);
    return limited;
  }

  try {
    const {
      productId,
      productName,
      issuerAddress,
      issuerAuthority,
      certType,
      scope,
      validityDays,
    } = parseJsonBody(request, await request.text(), regulatorCertificationBodySchema);

    const cert = issueCertification({
      productId,
      productName,
      issuerAddress,
      issuerAuthority,
      certType,
      scope,
      validityDays,
    });

    console.log('[regulator cert] issued', { id: cert.id, productId, issuerAuthority });

    const res = NextResponse.json({ certification: cert }, { status: 201 });
    recordRequest('POST /api/v1/regulator/certifications', 201, Date.now() - start);
    return withCors(request, withCorrelationId(request, res));
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_JSON, 'Invalid request'),
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/regulator/certifications',
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/regulator/certifications', 429, Date.now() - start);
    return limited;
  }

  const { searchParams } = request.nextUrl;
  const productId = searchParams.get('productId') ?? undefined;
  const issuer = searchParams.get('issuer') ?? undefined;

  const certs = issuer ? listByIssuer(issuer) : listCertifications(productId);

  // Resolve effective status for each cert
  const enriched = certs.map((c) => ({ ...c, effectiveStatus: effectiveStatus(c) }));

  const res = NextResponse.json(
    { certifications: enriched, total: enriched.length },
    { status: 200 },
  );
  recordRequest('GET /api/v1/regulator/certifications', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, res));
}
