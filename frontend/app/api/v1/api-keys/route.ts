/**
 * POST /api/v1/api-keys   — Issue a new API key
 * GET  /api/v1/api-keys   — List all API keys (admin only)
 *
 * Authentication: internal tier API key required (x-api-key header)
 * Rate limiting: default preset
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { withCorrelationId, ErrorCode, apiError } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { withIdempotency } from '@/lib/api/idempotency';
import { recordRequest } from '@/lib/api/metrics';
import { apiKeyIssueBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import {
  issueApiKey,
  listApiKeys,
  getApiKeyUsage,
  type ApiKeyTier,
} from '@/lib/api/apiKeyRegistry';

export const runtime = 'nodejs';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(request, 'POST /api/v1/api-keys', RATE_LIMIT_PRESETS.default);
  if (limited) {
    recordRequest('POST /api/v1/api-keys', 429, Date.now() - start);
    return limited;
  }

  // Only internal-tier callers may issue keys
  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('POST /api/v1/api-keys', 401, Date.now() - start);
    return auth.error;
  }

  const response = await withIdempotency(request, async (req, rawBody) => {
    try {
      const body = parseJsonBody(req, rawBody, apiKeyIssueBodySchema);
      const { name, tier, owner, description, expiresInDays } = body;

      const { record, plaintext } = await issueApiKey({
        name,
        tier: tier as ApiKeyTier,
        owner,
        description,
        expiresInDays,
      });

      // Return the plaintext key ONCE — it cannot be retrieved again
      const responseBody = {
        keyId: record.keyId,
        key: plaintext,
        name: record.name,
        tier: record.tier,
        owner: record.owner,
        description: record.description,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        message: 'Store this key securely — it will not be shown again.',
      };

      return withCors(
        req,
        withCorrelationId(req, NextResponse.json(responseBody, { status: 201 })),
      );
    } catch (error) {
      return withCors(
        req,
        handleValidationError(req, error) ??
          apiError(req, 400, ErrorCode.INVALID_JSON, 'Invalid JSON body'),
      );
    }
  });

  recordRequest('POST /api/v1/api-keys', response.status, Date.now() - start);
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(request, 'GET /api/v1/api-keys', RATE_LIMIT_PRESETS.default);
  if (limited) {
    recordRequest('GET /api/v1/api-keys', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('GET /api/v1/api-keys', 401, Date.now() - start);
    return auth.error;
  }

  const records = await listApiKeys();

  // Attach usage metrics to each record
  const keysWithUsage = await Promise.all(
    records.map(async (record) => {
      const usage = await getApiKeyUsage(record.keyId);
      return {
        keyId: record.keyId,
        name: record.name,
        tier: record.tier,
        owner: record.owner,
        description: record.description,
        createdAt: record.createdAt,
        expiresAt: record.expiresAt,
        revoked: record.revoked,
        revokedAt: record.revokedAt,
        usage: usage
          ? {
              totalRequests: usage.totalRequests,
              windowRequests: usage.windowRequests,
              lastUsedAt: usage.lastUsedAt,
              endpointCounts: usage.endpointCounts,
            }
          : null,
      };
    }),
  );

  const response = withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ keys: keysWithUsage, total: keysWithUsage.length }, { status: 200 }),
    ),
  );

  recordRequest('GET /api/v1/api-keys', response.status, Date.now() - start);
  return response;
}
