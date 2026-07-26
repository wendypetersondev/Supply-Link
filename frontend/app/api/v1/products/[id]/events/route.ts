/**
 * GET /api/v1/products/[id]/events  – list tracking events for a product (paginated)
 * POST /api/v1/products/[id]/events – add a new tracking event
 *
 * Authentication: x-api-key (partner or internal)
 * Rate limiting: partner tier
 * Idempotency: POST requests via Idempotency-Key header
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { withIdempotency } from '@/lib/api/idempotency';
import { getEventRepository, getProductRepository } from '@/lib/data';
import { recordRequest } from '@/lib/api/metrics';
import { validateEventMetadata } from '@/lib/api/eventMetadataSchemas';
import {
  trackingEventBatchBodySchema,
  trackingEventCreateBodySchema,
  trackingEventListQuerySchema,
} from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody, parseQuery } from '@/lib/api/validation';
import {
  claimEventSequence,
  getEventSequence,
  EventSequenceConflictError,
} from '@/lib/api/eventSequence';
import { enqueue } from '@/lib/jobs/queue';
import type { TrackingEvent, PaginatedResponse } from '@/lib/types';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

async function listEvents(
  req: NextRequest,
  productId: string,
  apiKey: string,
): Promise<NextResponse> {
  // Verify product exists
  const product = await getProductRepository().getById(productId);
  if (!product) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${productId}`);
  }

  const { offset, limit } = parseQuery(req, trackingEventListQuerySchema);

  const allEvents = await getEventRepository().listByProduct(productId);
  const items = allEvents.slice(offset, offset + limit);

  const response: PaginatedResponse<TrackingEvent> = {
    items,
    total: allEvents.length,
    offset,
    limit,
  };

  return withCors(req, withCorrelationId(req, NextResponse.json(response, { status: 200 })));
}

async function addEvent(
  req: NextRequest,
  productId: string,
  apiKey: string,
  rawBody: string,
): Promise<NextResponse> {
  // Verify product exists
  const product = await getProductRepository().getById(productId);
  if (!product) {
    return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${productId}`);
  }

  try {
    const body = parseJsonBody(req, rawBody, trackingEventCreateBodySchema);

    // Validate typed metadata shape by event type
    const metadata = body.metadata;
    const metadataValidation = validateEventMetadata(body.eventType, metadata);
    if (!metadataValidation.valid) {
      return apiError(
        req,
        400,
        ErrorCode.VALIDATION_ERROR,
        `Invalid metadata: ${metadataValidation.error}`,
      );
    }

    // ── Sequence enforcement (#476) ───────────────────────────────────────────
    // Clients must include the expected sequence number to prevent concurrent
    // submissions from creating inconsistent event histories.
    const claimedSeq = body.seq;

    let acceptedSeq: number;
    try {
      acceptedSeq = await claimEventSequence(productId, claimedSeq);
    } catch (err) {
      if (err instanceof EventSequenceConflictError) {
        return apiError(
          req,
          409,
          ErrorCode.VALIDATION_ERROR,
          `Event sequence conflict: expected ${err.conflict.expectedSeq}, received ${err.conflict.receivedSeq}. Fetch the latest sequence and retry.`,
        );
      }
      throw err;
    }

    // Create new event
    const newEvent: TrackingEvent = {
      productId,
      eventType: body.eventType,
      location: body.location,
      actor: body.actor,
      timestamp: Date.now(),
      metadata,
      seq: acceptedSeq,
    };

    // TODO: Persist to database instead of mock
    MOCK_EVENTS.push(newEvent);

    // Enqueue async validation job (#475)
    const stableId = newEvent.stableId ?? `${productId}-${acceptedSeq}-${newEvent.timestamp}`;
    await enqueue('event.validate', { event: { ...newEvent, stableId }, stableId });

    return withCors(req, withCorrelationId(req, NextResponse.json(newEvent, { status: 201 })));
  } catch (error) {
    return (
      handleValidationError(req, error) ??
      apiError(req, 500, ErrorCode.INTERNAL_ERROR, 'Failed to add event')
    );
  }
}

async function addEventsBatch(
  req: NextRequest,
  productId: string,
  apiKey: string,
  rawBody: string,
): Promise<NextResponse> {
  try {
    const payload = parseJsonBody(req, rawBody, trackingEventBatchBodySchema);

    const results: Array<Record<string, unknown>> = [];
    const product = getProductById(productId);
    if (!product) {
      return apiError(req, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${productId}`);
    }

    for (let i = 0; i < payload.length; i++) {
      const item = payload[i];
      const resEntry: Record<string, unknown> = { index: i };

      // Authorization: actor must be product owner or authorized actor
      const actorStr = item.actor;
      const isOwner = product.owner === actorStr;
      const isActor = product.authorizedActors?.includes(actorStr) ?? false;
      if (!isOwner && !isActor) {
        resEntry.success = false;
        resEntry.error = `Actor not authorized at index ${i}`;
        results.push(resEntry);
        continue;
      }

      // Metadata validation
      const metadata = item.metadata;
      const metadataValidation = validateEventMetadata(item.eventType, metadata);
      if (!metadataValidation.valid) {
        resEntry.success = false;
        resEntry.error = `Invalid metadata at index ${i}: ${metadataValidation.error}`;
        results.push(resEntry);
        continue;
      }

      // Create and persist (mock)
      const newEvent: TrackingEvent = {
        productId,
        eventType: item.eventType,
        location: item.location,
        actor: actorStr,
        timestamp: Date.now(),
        metadata,
      };
      MOCK_EVENTS.push(newEvent);

      resEntry.success = true;
      resEntry.event = newEvent;
      results.push(resEntry);
    }

    return withCors(req, withCorrelationId(req, NextResponse.json({ results }, { status: 200 })));
  } catch (error) {
    return (
      handleValidationError(req, error) ??
      apiError(req, 500, ErrorCode.INTERNAL_ERROR, 'Failed to add events')
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  // Public read endpoint — no authentication required.
  const limited = applyRateLimit(
    request,
    'GET /api/v1/products/[id]/events',
    RATE_LIMIT_PRESETS.publicRead,
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/products/[id]/events', 429, Date.now() - start);
    return limited;
  }

  const { id } = await params;

  if (!id || typeof id !== 'string') {
    recordRequest('GET /api/v1/products/[id]/events', 400, Date.now() - start);
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');
  }

  let response: NextResponse;
  try {
    response = await listEvents(request, id, '');
  } catch (error) {
    response =
      handleValidationError(request, error) ??
      apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to list events');
  }
  recordRequest('GET /api/v1/products/[id]/events', response.status, Date.now() - start);
  return response;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const start = Date.now();

  // Apply IP-based rate limiting
  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/[id]/events',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/[id]/events', 429, Date.now() - start);
    return limited;
  }

  // Authenticate API key
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/[id]/events', 401, Date.now() - start);
    return auth.error;
  }

  const { id } = await params;

  if (!id || typeof id !== 'string') {
    recordRequest('POST /api/v1/products/[id]/events', 400, Date.now() - start);
    return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Invalid product ID');
  }

  const rawBody = await request.text();

  // If the client sent an array payload, handle as a batch (no idempotency wrapper)
  let maybeArray: unknown;
  try {
    maybeArray = JSON.parse(rawBody);
  } catch {
    // fall through and let addEvent handle invalid JSON via idempotency path
    maybeArray = null;
  }

  let response: NextResponse;
  if (Array.isArray(maybeArray)) {
    response = await addEventsBatch(request, id, auth.apiKey!, rawBody);
  } else {
    // Handle single event with idempotency
    response = await withIdempotency(request, (req, body) => addEvent(req, id, auth.apiKey!, body));
  }

  recordRequest('POST /api/v1/products/[id]/events', response.status, Date.now() - start);
  return response;
}
