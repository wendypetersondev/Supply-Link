/**
 * POST /api/v1/certification-registry/records  — Issue a registry record
 * GET  /api/v1/certification-registry/records  — List records for a product
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import {
  certificationRecordCreateBodySchema,
  certificationRecordsListQuerySchema,
} from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody, parseQuery } from '@/lib/api/validation';
import { kvStore } from '@/lib/kv';
import type { CertificationIssuer, CertificationRegistryRecord } from '@/lib/types';

export const runtime = 'nodejs';

const TTL = 10 * 365 * 24 * 60 * 60;

function recordsKey(productId: string): string {
  return `cert-registry:records:${productId}`;
}

function issuerKey(address: string): string {
  return `cert-registry:issuer:${address}`;
}

async function getRecords(productId: string): Promise<CertificationRegistryRecord[]> {
  const raw = await kvStore.get(recordsKey(productId));
  return raw ? (JSON.parse(raw) as CertificationRegistryRecord[]) : [];
}

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/certification-registry/records',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/certification-registry/records', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/certification-registry/records', 401, Date.now() - start);
    return auth.error;
  }

  let body;
  try {
    body = parseJsonBody(request, await request.text(), certificationRecordCreateBodySchema);
  } catch (error) {
    return withCors(request, handleValidationError(request, error)!);
  }

  const { productId, issuerAddress, recordId, externalCertId, certType, documentHash } = body;

  // Validate issuer exists and is active
  const issuerRaw = await kvStore.get(issuerKey(issuerAddress));
  if (!issuerRaw) {
    return withCors(request, apiError(request, 404, ErrorCode.NOT_FOUND, 'Issuer not registered'));
  }
  const issuer = JSON.parse(issuerRaw) as CertificationIssuer;
  if (!issuer.active) {
    return withCors(
      request,
      apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Issuer is not active'),
    );
  }
  if (!issuer.certTypes.includes(certType)) {
    return withCors(
      request,
      apiError(
        request,
        400,
        ErrorCode.VALIDATION_ERROR,
        `cert_type '${certType}' not supported by issuer`,
      ),
    );
  }

  // Check for duplicate record ID
  const existing = await getRecords(productId);
  if (existing.some((r) => r.id === recordId)) {
    return withCors(
      request,
      apiError(request, 409, ErrorCode.CONFLICT, `Record with id '${recordId}' already exists`),
    );
  }

  const record: CertificationRegistryRecord = {
    id: recordId,
    productId,
    issuerAddress,
    externalCertId,
    certType,
    documentHash,
    issuedAt: Date.now(),
    revoked: false,
    revokedAt: 0,
  };

  existing.push(record);
  await kvStore.set(recordsKey(productId), JSON.stringify(existing), TTL);

  recordRequest('POST /api/v1/certification-registry/records', 201, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(record, { status: 201 })));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/certification-registry/records',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('GET /api/v1/certification-registry/records', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/certification-registry/records', 401, Date.now() - start);
    return auth.error;
  }

  let query;
  try {
    query = parseQuery(request, certificationRecordsListQuerySchema);
  } catch (error) {
    return withCors(request, handleValidationError(request, error)!);
  }

  const records = await getRecords(query.productId);

  recordRequest('GET /api/v1/certification-registry/records', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(records, { status: 200 })));
}
