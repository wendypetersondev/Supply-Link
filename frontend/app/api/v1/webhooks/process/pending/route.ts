import { NextRequest, NextResponse } from 'next/server';
import { notifyWebhooksOfEvent, retryFailedDeliveries } from '@/lib/webhooks/processor';
import { claimOnce } from '@/lib/webhooks/storage';
import {
  WEBHOOK_EVENT_DEDUPE_TTL_SECONDS,
  WEBHOOK_PROCESS_LOCK_TTL_SECONDS,
} from '@/lib/webhooks/config';
import type { TrackingEvent } from '@/lib/types';
import { apiError, ErrorCode } from '@/lib/api/errors';
import { webhookProcessPendingBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

const TICK_LOCK_KEY = 'webhook:process:tick:lock';

/**
 * POST /api/v1/webhooks/process/pending
 *
 * The webhook processing tick. Two independent, idempotent jobs run per call:
 *
 * 1. If an `event` is supplied, broadcast it — deduped so repeated calls for
 *    the same event (client retries, duplicate triggers) don't double-deliver.
 * 2. Always process any due delivery retries from the pending queue, guarded
 *    by a short-lived lock so overlapping/concurrent invocations of this tick
 *    don't process the same retry batch twice.
 *
 * This endpoint is safe to call repeatedly and concurrently — by a polling
 * service, a blockchain-triggered webhook, or a scheduled cron job.
 */
export async function POST(request: NextRequest) {
  try {
    const body = parseJsonBody(request, await request.text(), webhookProcessPendingBodySchema);
    const event = body.event as TrackingEvent | undefined;

    let eventResult = {
      delivered: true,
      successCount: 0,
      failureCount: 0,
      failedWebhookIds: [] as string[],
    };

    if (event) {
      // Idempotency: dedupe repeated deliveries of the same tracking event.
      const dedupeKey = `webhook:event:seen:${event.productId}:${event.eventType}:${event.timestamp}`;
      const isNewEvent = await claimOnce(dedupeKey, WEBHOOK_EVENT_DEDUPE_TTL_SECONDS);
      if (isNewEvent) {
        eventResult = await notifyWebhooksOfEvent(event);
      }
    }

    // Process due retries. The lock ensures at most one concurrent tick drains
    // the pending queue; a tick that misses the lock still completes the
    // `event` broadcast above.
    const acquiredTickLock = await claimOnce(TICK_LOCK_KEY, WEBHOOK_PROCESS_LOCK_TTL_SECONDS);
    if (acquiredTickLock) {
      await retryFailedDeliveries();
    }

    return NextResponse.json(
      {
        success: eventResult.delivered,
        successCount: eventResult.successCount,
        failureCount: eventResult.failureCount,
        failedWebhookIds: eventResult.failedWebhookIds,
      },
      { status: eventResult.delivered ? 200 : 500 },
    );
  } catch (err) {
    const validationResponse = handleValidationError(request, err);
    if (validationResponse) return validationResponse;
    console.error('Failed to process webhooks:', err);
    return apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to process webhooks');
  }
}
