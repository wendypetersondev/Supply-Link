/**
 * GET    /api/v1/alerts/[id]              – get a single alert
 * PATCH  /api/v1/alerts/[id]              – acknowledge or resolve an alert
 * DELETE /api/v1/alerts/[id]              – cancel an alert
 *
 * Authentication: x-api-key (partner or internal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { alertPatchBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import {
  getAlert,
  acknowledgeAlert,
  resolveAlert,
  cancelAlert,
} from '@/lib/services/emergencyAlerts';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/alerts/[id]',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/alerts/[id]', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/alerts/[id]', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  const alert = getAlert(id);

  if (!alert) {
    recordRequest('GET /api/v1/alerts/[id]', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Alert not found: ${id}`),
    );
  }

  recordRequest('GET /api/v1/alerts/[id]', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(alert, { status: 200 })));
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'PATCH /api/v1/alerts/[id]',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('PATCH /api/v1/alerts/[id]', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('PATCH /api/v1/alerts/[id]', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  let body;
  try {
    body = parseJsonBody(request, await request.text(), alertPatchBodySchema);
  } catch (error) {
    recordRequest('PATCH /api/v1/alerts/[id]', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  let updated;
  if (body.action === 'acknowledge') {
    updated = acknowledgeAlert(id, body.acknowledgedBy ?? 'unknown');
  } else {
    updated = resolveAlert(id);
  }

  if (!updated) {
    recordRequest('PATCH /api/v1/alerts/[id]', 404, Date.now() - start);
    return withCors(
      request,
      apiError(
        request,
        404,
        ErrorCode.VALIDATION_ERROR,
        `Alert not found or already resolved: ${id}`,
      ),
    );
  }

  recordRequest('PATCH /api/v1/alerts/[id]', 200, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(updated, { status: 200 })));
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('DELETE /api/v1/alerts/[id]', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;
  const cancelled = cancelAlert(id);

  if (!cancelled) {
    recordRequest('DELETE /api/v1/alerts/[id]', 404, Date.now() - start);
    return withCors(
      request,
      apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Alert not found: ${id}`),
    );
  }

  recordRequest('DELETE /api/v1/alerts/[id]', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(request, NextResponse.json({ ok: true, id }, { status: 200 })),
  );
}
