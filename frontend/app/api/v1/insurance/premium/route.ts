/**
 * POST /api/v1/insurance/premium – calculate real-time premium quote
 * GET  /api/v1/insurance/premium – list available providers
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { insurancePremiumBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import {
  assessRisk,
  calculatePremium,
  listProviders,
  getProvider,
} from '@/lib/services/insuranceCoverage';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/insurance/premium',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/insurance/premium', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/insurance/premium', 401, Date.now() - start);
    return auth.error;
  }

  const providers = listProviders();
  recordRequest('GET /api/v1/insurance/premium', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ providers, total: providers.length }, { status: 200 }),
    ),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/insurance/premium',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/insurance/premium', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/insurance/premium', 401, Date.now() - start);
    return auth.error;
  }

  let body;
  try {
    body = parseJsonBody(request, await request.text(), insurancePremiumBodySchema);
  } catch (error) {
    recordRequest('POST /api/v1/insurance/premium', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  const providerConfig = getProvider(body.provider);
  if (!providerConfig) {
    recordRequest('POST /api/v1/insurance/premium', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Unknown provider: ${body.provider}`),
    );
  }

  const risk = assessRisk({
    productId: body.productId,
    productValue: body.productValue,
    hasRecallHistory: body.hasRecallHistory,
    transitRiskScore: body.transitRiskScore,
    certificationCount: body.certificationCount,
    storageRiskScore: body.storageRiskScore,
  });

  const quote = calculatePremium({
    productId: body.productId,
    provider: body.provider,
    coverageType: body.coverageType,
    coverageAmount: body.coverageAmount,
    currency: body.currency,
    riskAssessment: risk,
  });

  recordRequest('POST /api/v1/insurance/premium', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json({ quote, riskAssessment: risk }, { status: 200 })),
  );
}
