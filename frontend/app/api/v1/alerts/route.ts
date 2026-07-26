/**
 * GET  /api/v1/alerts        – list emergency alerts (optionally filtered by productId)
 * POST /api/v1/alerts        – create a new emergency alert
 *
 * Authentication: x-api-key (partner or internal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { withCorrelationId } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { alertsListQuerySchema, createAlertBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody, parseQuery } from '@/lib/api/validation';
import {
  createAlert,
  listAlerts,
  listActiveAlerts,
  getAlertStats,
} from '@/lib/services/emergencyAlerts';
import type { AlertSeverity, AlertChannel } from '@/lib/services/emergencyAlerts';
import { notifyWebhooksOfProductEvent } from '@/lib/webhooks/processor';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/alerts',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('GET /api/v1/alerts', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/alerts', 401, Date.now() - start);
    return auth.error;
  }

  let query;
  try {
    query = parseQuery(request, alertsListQuerySchema);
  } catch (error) {
    recordRequest('GET /api/v1/alerts', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  const alerts = query.active ? listActiveAlerts(query.productId) : listAlerts(query.productId);
  const stats = getAlertStats();

  recordRequest('GET /api/v1/alerts', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ alerts, stats, total: alerts.length }, { status: 200 }),
    ),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/alerts',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.authenticated,
  );
  if (limited) {
    recordRequest('POST /api/v1/alerts', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'internal');
  if (auth.error) {
    recordRequest('POST /api/v1/alerts', 401, Date.now() - start);
    return auth.error;
  }

  let body;
  try {
    body = parseJsonBody(request, await request.text(), createAlertBodySchema);
  } catch (error) {
    recordRequest('POST /api/v1/alerts', 400, Date.now() - start);
    return withCors(request, handleValidationError(request, error)!);
  }

  const alert = createAlert(body);

  // Fan out to webhook subscribers if webhook channel is enabled
  if (body.distribution.channels.includes('webhook')) {
    void notifyWebhooksOfProductEvent('product_updated', body.productId, {
      alertId: alert.id,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
    }).catch((err) => console.error('[alerts] webhook delivery failed:', err));
  }

  recordRequest('POST /api/v1/alerts', 201, Date.now() - start);
  return withCors(request, withCorrelationId(request, NextResponse.json(alert, { status: 201 })));
}
