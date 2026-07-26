/**
 * Webhook Subscription Management Endpoints
 *
 * GET    /api/v1/webhooks/[id]/subscriptions           - List subscriptions for a webhook
 * POST   /api/v1/webhooks/[id]/subscriptions           - Create a subscription
 * GET    /api/v1/webhooks/[id]/subscriptions/[subId]   - Get subscription details
 * PATCH  /api/v1/webhooks/[id]/subscriptions/[subId]   - Update a subscription
 * DELETE /api/v1/webhooks/[id]/subscriptions/[subId]   - Delete a subscription
 *
 * Authentication: x-api-key (partner or internal)
 * Rate limiting: partner tier
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { getWebhookById } from '@/lib/webhooks/storage';
import {
  getSubscriptionsByWebhookId,
  getSubscriptionById,
  createSubscription,
  updateSubscription,
  deleteSubscription,
} from '@/lib/webhooks/subscriptions';
import type {
  WebhookSubscriptionRequest,
  WebhookSubscriptionResponse,
  WebhookSubscriptionListResponse,
  WebhookEventType,
  ProductEventType,
} from '@/lib/webhooks/types';
import {
  webhookSubscriptionCreateBodySchema,
  webhookSubscriptionPatchBodySchema,
} from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

async function listSubscriptions(req: NextRequest, webhookId: string): Promise<NextResponse> {
  // Verify webhook exists
  const webhook = await getWebhookById(webhookId);
  if (!webhook) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Webhook not found: ${webhookId}`);
  }

  const subscriptions = await getSubscriptionsByWebhookId(webhookId);
  const response: WebhookSubscriptionListResponse = {
    subscriptions: subscriptions.map((s) => ({
      id: s.id,
      webhookId: s.webhookId,
      name: s.name,
      description: s.description,
      eventTypes: s.eventTypes,
      productEventFilter: s.productEventFilter,
      retryPolicy: s.retryPolicy,
      active: s.active,
      createdAt: s.createdAt,
      lastTriggeredAt: s.lastTriggeredAt,
    })),
    total: subscriptions.length,
  };

  return withCors(req, withCorrelationId(req, NextResponse.json(response, { status: 200 })));
}

async function createNewSubscription(
  req: NextRequest,
  webhookId: string,
  rawBody: string,
): Promise<NextResponse> {
  // Verify webhook exists
  const webhook = await getWebhookById(webhookId);
  if (!webhook) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Webhook not found: ${webhookId}`);
  }

  try {
    const body = parseJsonBody(req, rawBody, webhookSubscriptionCreateBodySchema);

    // Validate event types

    const validEventTypes: WebhookEventType[] = ['TRACKING_EVENT_CREATED', 'PRODUCT_EVENT_CHANGED'];
    const eventTypes = body.eventTypes as WebhookEventType[];
    if (!eventTypes.every((et) => validEventTypes.includes(et))) {
      return apiError(
        req,
        400,
        ErrorCode.VALIDATION_ERROR,
        `Invalid eventTypes. Allowed: ${validEventTypes.join(', ')}`,
      );
    }

    // Validate product event filter if provided
    let productEventFilter: { types?: ProductEventType[]; productIds?: string[] } | undefined;
    if (body.productEventFilter) {
      const filter = body.productEventFilter;
      productEventFilter = {};

      const validProductEventTypes: ProductEventType[] = [
        'product_registered',
        'product_updated',
        'event_added',
        'actor_authorized',
        'actor_removed',
        'compliance_policy_updated',
      ];

      if (filter.types) {
        const types = filter.types as ProductEventType[];
        if (!types.every((t) => validProductEventTypes.includes(t))) {
          return apiError(
            req,
            400,
            ErrorCode.VALIDATION_ERROR,
            `Invalid product event types. Allowed: ${validProductEventTypes.join(', ')}`,
          );
        }
        productEventFilter.types = types;
      }

      if (filter.productIds) {
        productEventFilter.productIds = filter.productIds;
      }
    }

    // Validate retry policy if provided
    let retryPolicy: { maxRetries?: number; backoffMs?: number; maxBackoffMs?: number } | undefined;
    if (body.retryPolicy) {
      const policy = body.retryPolicy;
      retryPolicy = {};

      if (policy.maxRetries !== undefined) {
        if (policy.maxRetries < 0 || policy.maxRetries > 10) {
          return apiError(
            req,
            400,
            ErrorCode.VALIDATION_ERROR,
            'maxRetries must be between 0 and 10',
          );
        }
        retryPolicy.maxRetries = policy.maxRetries;
      }

      if (policy.backoffMs !== undefined) {
        if (policy.backoffMs < 100 || policy.backoffMs > 60000) {
          return apiError(
            req,
            400,
            ErrorCode.VALIDATION_ERROR,
            'backoffMs must be between 100 and 60000',
          );
        }
        retryPolicy.backoffMs = policy.backoffMs;
      }

      if (policy.maxBackoffMs !== undefined) {
        if (policy.maxBackoffMs < (policy.backoffMs ?? 0) || policy.maxBackoffMs > 86400000) {
          return apiError(
            req,
            400,
            ErrorCode.VALIDATION_ERROR,
            'maxBackoffMs must be >= backoffMs and <= 86400000',
          );
        }
        retryPolicy.maxBackoffMs = policy.maxBackoffMs;
      }
    }

    // Create subscription
    const subscription = await createSubscription(webhookId, body.name, eventTypes, {
      description: body.description,
      productEventFilter,
      retryPolicy,
    });

    const response: WebhookSubscriptionResponse = {
      id: subscription.id,
      webhookId: subscription.webhookId,
      name: subscription.name,
      description: subscription.description,
      eventTypes: subscription.eventTypes,
      productEventFilter: subscription.productEventFilter,
      retryPolicy: subscription.retryPolicy,
      active: subscription.active,
      createdAt: subscription.createdAt,
      lastTriggeredAt: subscription.lastTriggeredAt,
    };

    return withCors(req, withCorrelationId(req, NextResponse.json(response, { status: 201 })));
  } catch (error) {
    return withCors(
      req,
      handleValidationError(req, error) ??
        apiError(req, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid request'),
    );
  }
}

async function getSubscriptionDetails(
  req: NextRequest,
  webhookId: string,
  subscriptionId: string,
): Promise<NextResponse> {
  // Verify webhook exists
  const webhook = await getWebhookById(webhookId);
  if (!webhook) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Webhook not found: ${webhookId}`);
  }

  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription || subscription.webhookId !== webhookId) {
    return apiError(
      req,
      404,
      ErrorCode.VALIDATION_ERROR,
      `Subscription not found: ${subscriptionId}`,
    );
  }

  const response: WebhookSubscriptionResponse = {
    id: subscription.id,
    webhookId: subscription.webhookId,
    name: subscription.name,
    description: subscription.description,
    eventTypes: subscription.eventTypes,
    productEventFilter: subscription.productEventFilter,
    retryPolicy: subscription.retryPolicy,
    active: subscription.active,
    createdAt: subscription.createdAt,
    lastTriggeredAt: subscription.lastTriggeredAt,
  };

  return withCors(req, withCorrelationId(req, NextResponse.json(response, { status: 200 })));
}

async function updateSubscriptionDetails(
  req: NextRequest,
  webhookId: string,
  subscriptionId: string,
  rawBody: string,
): Promise<NextResponse> {
  // Verify webhook exists
  const webhook = await getWebhookById(webhookId);
  if (!webhook) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Webhook not found: ${webhookId}`);
  }

  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription || subscription.webhookId !== webhookId) {
    return apiError(
      req,
      404,
      ErrorCode.VALIDATION_ERROR,
      `Subscription not found: ${subscriptionId}`,
    );
  }

  try {
    const body = parseJsonBody(req, rawBody, webhookSubscriptionPatchBodySchema);
    const updates: Record<string, unknown> = {};

    // Allow updating active status
    if (body.active !== undefined) {
      updates.active = body.active;
    }

    // Allow updating name
    if (body.name !== undefined) {
      updates.name = body.name;
    }

    // Allow updating description
    if (body.description !== undefined) {
      updates.description = body.description;
    }

    const updated = await updateSubscription(subscriptionId, updates);
    if (!updated) {
      return apiError(req, 404, ErrorCode.VALIDATION_ERROR, 'Subscription not found');
    }

    const response: WebhookSubscriptionResponse = {
      id: updated.id,
      webhookId: updated.webhookId,
      name: updated.name,
      description: updated.description,
      eventTypes: updated.eventTypes,
      productEventFilter: updated.productEventFilter,
      retryPolicy: updated.retryPolicy,
      active: updated.active,
      createdAt: updated.createdAt,
      lastTriggeredAt: updated.lastTriggeredAt,
    };

    return withCors(req, withCorrelationId(req, NextResponse.json(response, { status: 200 })));
  } catch (error) {
    return withCors(
      req,
      handleValidationError(req, error) ??
        apiError(req, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid request'),
    );
  }
}

async function deleteSubscriptionDetails(
  req: NextRequest,
  webhookId: string,
  subscriptionId: string,
): Promise<NextResponse> {
  // Verify webhook exists
  const webhook = await getWebhookById(webhookId);
  if (!webhook) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Webhook not found: ${webhookId}`);
  }

  const subscription = await getSubscriptionById(subscriptionId);
  if (!subscription || subscription.webhookId !== webhookId) {
    return apiError(
      req,
      404,
      ErrorCode.VALIDATION_ERROR,
      `Subscription not found: ${subscriptionId}`,
    );
  }

  const deleted = await deleteSubscription(subscriptionId);
  if (!deleted) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, 'Subscription not found');
  }

  return withCors(
    req,
    withCorrelationId(req, NextResponse.json({ success: true }, { status: 200 })),
  );
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subId?: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  // Apply rate limiting
  const limited = applyRateLimit(
    request,
    'GET /api/v1/webhooks/[id]/subscriptions',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('GET /api/v1/webhooks/[id]/subscriptions', 429, Date.now() - start);
    return limited;
  }

  // Authenticate API key
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/webhooks/[id]/subscriptions', 401, Date.now() - start);
    return auth.error;
  }

  const { id, subId } = await params;

  if (!id || typeof id !== 'string') {
    recordRequest('GET /api/v1/webhooks/[id]/subscriptions', 400, Date.now() - start);
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid webhook ID');
  }

  let response: NextResponse;
  if (subId && typeof subId === 'string') {
    response = await getSubscriptionDetails(request, id, subId);
  } else {
    response = await listSubscriptions(request, id);
  }

  recordRequest('GET /api/v1/webhooks/[id]/subscriptions', response.status, Date.now() - start);
  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  // Apply rate limiting
  const limited = applyRateLimit(
    request,
    'POST /api/v1/webhooks/[id]/subscriptions',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/webhooks/[id]/subscriptions', 429, Date.now() - start);
    return limited;
  }

  // Authenticate API key
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/webhooks/[id]/subscriptions', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  if (!id || typeof id !== 'string') {
    recordRequest('POST /api/v1/webhooks/[id]/subscriptions', 400, Date.now() - start);
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid webhook ID');
  }

  const rawBody = await request.text();
  const response = await createNewSubscription(request, id, rawBody);

  recordRequest('POST /api/v1/webhooks/[id]/subscriptions', response.status, Date.now() - start);
  return response;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subId?: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  // Apply rate limiting
  const limited = applyRateLimit(
    request,
    'PATCH /api/v1/webhooks/[id]/subscriptions/[subId]',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('PATCH /api/v1/webhooks/[id]/subscriptions/[subId]', 429, Date.now() - start);
    return limited;
  }

  // Authenticate API key
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('PATCH /api/v1/webhooks/[id]/subscriptions/[subId]', 401, Date.now() - start);
    return auth.error;
  }

  const { id, subId } = await params;

  if (!id || typeof id !== 'string' || !subId || typeof subId !== 'string') {
    recordRequest('PATCH /api/v1/webhooks/[id]/subscriptions/[subId]', 400, Date.now() - start);
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid webhook or subscription ID');
  }

  const rawBody = await request.text();
  const response = await updateSubscriptionDetails(request, id, subId, rawBody);

  recordRequest(
    'PATCH /api/v1/webhooks/[id]/subscriptions/[subId]',
    response.status,
    Date.now() - start,
  );
  return response;
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; subId?: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  // Apply rate limiting
  const limited = applyRateLimit(
    request,
    'DELETE /api/v1/webhooks/[id]/subscriptions/[subId]',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('DELETE /api/v1/webhooks/[id]/subscriptions/[subId]', 429, Date.now() - start);
    return limited;
  }

  // Authenticate API key
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('DELETE /api/v1/webhooks/[id]/subscriptions/[subId]', 401, Date.now() - start);
    return auth.error;
  }

  const { id, subId } = await params;

  if (!id || typeof id !== 'string' || !subId || typeof subId !== 'string') {
    recordRequest('DELETE /api/v1/webhooks/[id]/subscriptions/[subId]', 400, Date.now() - start);
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid webhook or subscription ID');
  }

  const response = await deleteSubscriptionDetails(request, id, subId);

  recordRequest(
    'DELETE /api/v1/webhooks/[id]/subscriptions/[subId]',
    response.status,
    Date.now() - start,
  );
  return response;
}
