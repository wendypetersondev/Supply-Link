/**
 * GET  /api/v1/gas-estimate?operation=<op>[&productId=<id>][&batchSize=<n>]
 * POST /api/v1/gas-estimate
 *
 * Returns CPU-instruction and XLM fee estimates for common contract operations.
 *
 * Supported operations:
 *   register_product      — single product registration
 *   add_tracking_event    — single event (O(1) keyed storage)
 *   batch_register        — register_products_batch (scales linearly, max 50)
 *   batch_add_events      — batch_add_tracking_events (scales linearly, max 20)
 *   get_events_page       — get_tracking_events_page (10 entries)
 *   transfer_ownership    — ownership transfer
 *
 * Accuracy: estimates are within ~5% of measured profiling suite values.
 * All CPU figures are Soroban CPU instruction counts from profiling.rs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { recordRequest } from '@/lib/api/metrics';
import { fetchBaseFee, stroopsToXlm } from '@/lib/stellar/fees';
import { gasEstimateQuerySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody, parseQuery } from '@/lib/api/validation';

export const runtime = 'nodejs';

// ── CPU instruction baselines from profiling.rs ──────────────────────────────
// Values are measured medians; multiply by batchSize for batch operations.

const CPU_BASELINES: Record<string, number> = {
  register_product: 1_200_000,
  add_tracking_event: 1_800_000, // O(1) with keyed storage
  get_events_page: 1_200_000, // 10-entry page
  transfer_ownership: 900_000,
};

// Soroban resource-fee multiplier: CPU instructions → stroops (approximate).
// 1M CPU instructions ≈ 0.001 XLM on testnet (subject to network fee schedule).
const CPU_TO_STROOP_RATIO = 0.001 / 1_000_000;

export type Operation =
  | 'register_product'
  | 'add_tracking_event'
  | 'batch_register'
  | 'batch_add_events'
  | 'get_events_page'
  | 'transfer_ownership';

export interface GasEstimate {
  operation: Operation;
  batchSize: number;
  cpuInstructions: number;
  /** Soroban resource fee estimate in stroops. */
  resourceFeeStroops: number;
  resourceFeeXlm: string;
  /** Inclusion fee on top of the resource fee (from current network). */
  inclusionFeeStroops: number;
  inclusionFeeXlm: string;
  totalFeeStroops: number;
  totalFeeXlm: string;
  /** Estimated accuracy band — profiling suite measures within ±5% of real execution. */
  accuracyBand: string;
  note: string;
}

function buildEstimate(operation: Operation, batchSize: number, inclusionFee: number): GasEstimate {
  let baseCpu: number;
  let note: string;

  switch (operation) {
    case 'register_product':
      baseCpu = CPU_BASELINES.register_product;
      note = 'O(1): 2 storage writes + 1 counter RMW';
      break;
    case 'add_tracking_event':
      baseCpu = CPU_BASELINES.add_tracking_event;
      note = 'O(1): per-event keyed storage; cost is constant regardless of event history';
      break;
    case 'batch_register':
      baseCpu = CPU_BASELINES.register_product * batchSize;
      note = `O(n): ${batchSize} product registrations; scales linearly (max 50)`;
      break;
    case 'batch_add_events':
      baseCpu = CPU_BASELINES.add_tracking_event * batchSize;
      note = `O(n): ${batchSize} event writes; each is O(1) so total scales linearly (max 20)`;
      break;
    case 'get_events_page':
      baseCpu = CPU_BASELINES.get_events_page;
      note = 'O(page_size): reads 10 EventEntry keys; independent of total event count';
      break;
    case 'transfer_ownership':
      baseCpu = CPU_BASELINES.transfer_ownership;
      note = 'O(1): 1 read + 1 write';
      break;
  }

  const resourceFeeStroops = Math.ceil(baseCpu * CPU_TO_STROOP_RATIO * 1_000_000);
  const totalFeeStroops = resourceFeeStroops + inclusionFee;

  return {
    operation,
    batchSize,
    cpuInstructions: baseCpu,
    resourceFeeStroops,
    resourceFeeXlm: stroopsToXlm(resourceFeeStroops),
    inclusionFeeStroops: inclusionFee,
    inclusionFeeXlm: stroopsToXlm(inclusionFee),
    totalFeeStroops,
    totalFeeXlm: stroopsToXlm(totalFeeStroops),
    accuracyBand: '±5%',
    note,
  };
}

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(request, 'GET /api/v1/gas-estimate', RATE_LIMIT_PRESETS.default);
  if (limited) {
    recordRequest('GET /api/v1/gas-estimate', 429, Date.now() - start);
    return limited;
  }

  let operation: Operation;
  let batchSize: number;
  try {
    ({ operation, batchSize } = parseQuery(request, gasEstimateQuerySchema));
  } catch (error) {
    const res = withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Request validation failed'),
    );
    recordRequest('GET /api/v1/gas-estimate', 400, Date.now() - start);
    return res;
  }
  const inclusionFee = await fetchBaseFee();
  const estimate = buildEstimate(operation as Operation, batchSize, inclusionFee);

  const response = withCors(
    request,
    withCorrelationId(request, NextResponse.json(estimate, { status: 200 })),
  );
  recordRequest('GET /api/v1/gas-estimate', 200, Date.now() - start);
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(request, 'POST /api/v1/gas-estimate', RATE_LIMIT_PRESETS.default);
  if (limited) {
    recordRequest('POST /api/v1/gas-estimate', 429, Date.now() - start);
    return limited;
  }

  let body: { operation: Operation; batchSize: number };
  try {
    body = parseJsonBody(request, await request.text(), gasEstimateQuerySchema);
  } catch (error) {
    const res = withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Request validation failed'),
    );
    recordRequest('POST /api/v1/gas-estimate', 400, Date.now() - start);
    return res;
  }

  const { operation, batchSize } = body;
  const inclusionFee = await fetchBaseFee();
  const estimate = buildEstimate(operation as Operation, batchSize, inclusionFee);

  const response = withCors(
    request,
    withCorrelationId(request, NextResponse.json(estimate, { status: 200 })),
  );
  recordRequest('POST /api/v1/gas-estimate', 200, Date.now() - start);
  return response;
}
