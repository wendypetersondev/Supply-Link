/**
 * POST /api/v1/events/archive  — Archive a tracking event by stable_id
 * GET  /api/v1/events/archive  — List archived events for a product
 *
 * Authentication: x-api-key (partner or internal)
 * Rate limiting: default preset
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { recordRequest } from '@/lib/api/metrics';
import { kvStore } from '@/lib/kv';
import type { ArchivedEvent, TrackingEvent } from '@/lib/types';
import { eventArchiveBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export const runtime = 'nodejs';

// ── KV helpers ────────────────────────────────────────────────────────────────

const ARCHIVE_TTL = 10 * 365 * 24 * 60 * 60; // 10 years

function archiveListKey(productId: string): string {
  return `archive:events:${productId}`;
}

async function getArchivedEvents(productId: string): Promise<ArchivedEvent[]> {
  const raw = await kvStore.get(archiveListKey(productId));
  if (!raw) return [];
  try {
    return JSON.parse(raw) as ArchivedEvent[];
  } catch {
    return [];
  }
}

async function saveArchivedEvents(productId: string, events: ArchivedEvent[]): Promise<void> {
  await kvStore.set(archiveListKey(productId), JSON.stringify(events), ARCHIVE_TTL);
}

// ── Validation ────────────────────────────────────────────────────────────────

// ── Handlers ──────────────────────────────────────────────────────────────────

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/events/archive',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/events/archive', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/events/archive', 401, Date.now() - start);
    return auth.error;
  }

  try {
    const { productId, stableId, reason } = parseJsonBody(
      request,
      await request.text(),
      eventArchiveBodySchema,
    );
    // Retrieve active events from KV (mock layer — in production this calls the contract)
    const activeKey = `events:active:${productId}`;
    const activeRaw = await kvStore.get(activeKey);
    const activeEvents: TrackingEvent[] = activeRaw
      ? (JSON.parse(activeRaw) as TrackingEvent[])
      : [];
    const targetIndex = activeEvents.findIndex((e) => e.stableId === stableId);
    if (targetIndex === -1)
      return withCors(
        request,
        apiError(
          request,
          404,
          ErrorCode.NOT_FOUND,
          `Event with stableId '${stableId}' not found in active list`,
        ),
      );
    const [targetEvent] = activeEvents.splice(targetIndex, 1);
    await kvStore.set(activeKey, JSON.stringify(activeEvents), ARCHIVE_TTL);
    const archived: ArchivedEvent = {
      event: { ...targetEvent, archived: true },
      archivedBy: auth.apiKey ?? 'system',
      archivedAt: Date.now(),
      reason,
    };
    const existing = await getArchivedEvents(productId);
    existing.push(archived);
    await saveArchivedEvents(productId, existing);
    recordRequest('POST /api/v1/events/archive', 201, Date.now() - start);
    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(archived, { status: 201 })),
    );
  } catch (error) {
    recordRequest('POST /api/v1/events/archive', 400, Date.now() - start);
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_JSON, 'Invalid request'),
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(request, 'GET /api/v1/events/archive', RATE_LIMIT_PRESETS.default);
  if (limited) {
    recordRequest('GET /api/v1/events/archive', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('GET /api/v1/events/archive', 401, Date.now() - start);
    return auth.error;
  }

  const productId = request.nextUrl.searchParams.get('productId');
  if (!productId) {
    recordRequest('GET /api/v1/events/archive', 400, Date.now() - start);
    return withCors(
      request,
      apiError(request, 400, ErrorCode.MISSING_FIELDS, 'productId is required'),
    );
  }

  const offset = parseInt(request.nextUrl.searchParams.get('offset') ?? '0', 10);
  const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '0', 10);

  const all = await getArchivedEvents(productId);
  const items = limit > 0 ? all.slice(offset, offset + limit) : all.slice(offset);

  recordRequest('GET /api/v1/events/archive', 200, Date.now() - start);
  return withCors(
    request,
    withCorrelationId(
      request,
      NextResponse.json({ items, total: all.length, offset, limit }, { status: 200 }),
    ),
  );
}
