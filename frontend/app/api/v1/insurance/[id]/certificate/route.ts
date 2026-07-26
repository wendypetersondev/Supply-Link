/**
 * POST /api/v1/insurance/[id]/certificate – generate blockchain-verified certificate
 * GET  /api/v1/insurance/[id]/certificate – list certificates for a coverage record
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { insuranceCertificateBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import {
  getCoverage,
  generateInsuranceCertificate,
  listCertificatesForCoverage,
} from '@/lib/services/insuranceCoverage';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/insurance/[id]/certificate', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  const certificates = listCertificatesForCoverage(id);

  recordRequest('GET /api/v1/insurance/[id]/certificate', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ certificates, total: certificates.length }, { status: 200 }),
    ),
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/insurance/[id]/certificate',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/insurance/[id]/certificate', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('POST /api/v1/insurance/[id]/certificate', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  const coverage = getCoverage(id);
  if (!coverage) {
    recordRequest('POST /api/v1/insurance/[id]/certificate', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Coverage record not found: ${id}`),
    );
  }

  let body;
  try {
    body = parseJsonBody(request, await request.text(), insuranceCertificateBodySchema);
  } catch (error) {
    recordRequest('POST /api/v1/insurance/[id]/certificate', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  const certificate = generateInsuranceCertificate(id, body.issuedBy);
  if (!certificate) {
    recordRequest('POST /api/v1/insurance/[id]/certificate', 422, Date.now() - start);
    return withCors(
      request,
      apiError(
        request,
        422,
        ErrorCode.VALIDATION_ERROR,
        'Cannot generate certificate for voided coverage',
      ),
    );
  }

  recordRequest('POST /api/v1/insurance/[id]/certificate', 201, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json(certificate, { status: 201 })),
  );
}
