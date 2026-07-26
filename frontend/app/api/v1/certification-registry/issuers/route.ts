/**
 * POST /api/v1/certification-registry/issuers  — Register a certification issuer
 * GET  /api/v1/certification-registry/issuers  — List all registered issuers
 *
 * Authentication: x-api-key (partner or internal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { certificationIssuerCreateBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import { kvStore } from '@/lib/kv';
import type { CertificationIssuer } from '@/lib/types';

export const runtime = 'nodejs';

const TTL = 10 * 365 * 24 * 60 * 60;

function issuerKey(address: string): string {
  return `cert-registry:issuer:${address}`;
}

const ISSUERS_INDEX_KEY = 'cert-registry:issuers:index';

async function getIssuerIndex(): Promise<string[]> {
  const raw = await kvStore.get(ISSUERS_INDEX_KEY);
  return raw ? (JSON.parse(raw) as string[]) : [];
}

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/certification-registry/issuers',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/certification-registry/issuers', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/certification-registry/issuers', 401, Date.now() - start);
    return auth.error;
  }

  let body;
  try {
    body = parseJsonBody(request, await request.text(), certificationIssuerCreateBodySchema);
  } catch (error) {
    return withCors(request, handleValidationError(request, error)!);
  }

  const { issuerAddress, name, certTypes } = body;

  // Check for duplicate active registration
  const existing = await kvStore.get(issuerKey(issuerAddress));
  if (existing) {
    const iss = JSON.parse(existing) as CertificationIssuer;
    if (iss.active) {
      return withCors(
        request,
        apiError(request, 409, ErrorCode.CONFLICT, 'Issuer already registered'),
      );
    }
  }

  const issuer: CertificationIssuer = {
    issuerAddress,
    name,
    certTypes,
    registeredAt: Date.now(),
    active: true,
  };

  await kvStore.set(issuerKey(issuerAddress), JSON.stringify(issuer), TTL);

  // Update index
  const index = await getIssuerIndex();
  if (!index.includes(issuerAddress)) {
    index.push(issuerAddress);
    await kvStore.set(ISSUERS_INDEX_KEY, JSON.stringify(index), TTL);
  }

  recordRequest('POST /api/v1/certification-registry/issuers', 201, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(issuer, { status: 201 })));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/certification-registry/issuers',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('GET /api/v1/certification-registry/issuers', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/certification-registry/issuers', 401, Date.now() - start);
    return auth.error;
  }

  const index = await getIssuerIndex();
  const issuers: CertificationIssuer[] = [];

  for (const addr of index) {
    const raw = await kvStore.get(issuerKey(addr));
    if (raw) issuers.push(JSON.parse(raw) as CertificationIssuer);
  }

  recordRequest('GET /api/v1/certification-registry/issuers', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(issuers, { status: 200 })));
}
