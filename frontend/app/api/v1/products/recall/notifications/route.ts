/**
 * GET /api/v1/products/recall/notifications – get stakeholder notifications
 * POST /api/v1/products/recall/notifications/acknowledge – acknowledge a notification
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import {
  getStakeholderNotifications,
  acknowledgeNotification,
  getBroadcastStats,
} from '@/lib/services/recallBroadcastService';
import { recordRequest } from '@/lib/api/metrics';
import { recallNotificationAcknowledgeBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'GET /api/v1/products/recall/notifications',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('GET /api/v1/products/recall/notifications', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/products/recall/notifications', 401, Date.now() - start);
    return auth.error;
  }

  const stakeholder =
    request.headers.get('x-stakeholder-id') || request.headers.get('x-user-id') || 'default';
  const notifications = getStakeholderNotifications(stakeholder);
  const stats = getBroadcastStats();

  recordRequest('GET /api/v1/products/recall/notifications', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json(
        {
          notifications,
          stats,
        },
        { status: 200 },
      ),
    ),
  );
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/recall/notifications/acknowledge',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest(
      'POST /api/v1/products/recall/notifications/acknowledge',
      429,
      Date.now() - start,
    );
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest(
      'POST /api/v1/products/recall/notifications/acknowledge',
      401,
      Date.now() - start,
    );
    return auth.error;
  }

  try {
    const body = parseJsonBody(
      request,
      await request.text(),
      recallNotificationAcknowledgeBodySchema,
    );
    const stakeholder =
      request.headers.get('x-stakeholder-id') || request.headers.get('x-user-id') || 'default';
    const notification = acknowledgeNotification(stakeholder, body.broadcastId);
    if (!notification) return apiError(request, 404, ErrorCode.NOT_FOUND, 'Notification not found');
    recordRequest(
      'POST /api/v1/products/recall/notifications/acknowledge',
      200,
      Date.now() - start,
    );
    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(notification, { status: 200 })),
    );
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid request'),
    );
  }
}
