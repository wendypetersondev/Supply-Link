/**
 * GET  /api/v1/contract/pause  — return current pause state
 * POST /api/v1/contract/pause  — set pause state (guardian only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { apiError, ErrorCode } from '@/lib/api/errors';
import { contractPauseBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

// In production this would read from / write to the Soroban contract via RPC.
// For now we use a module-level variable as a lightweight stand-in that
// survives the process lifetime (suitable for dev/test; replace with KV or
// contract call in production).
let pauseState = {
  paused: false,
  pausedBy: undefined as string | undefined,
  pausedAt: undefined as number | undefined,
  reason: undefined as string | undefined,
};

export async function GET() {
  return NextResponse.json(pauseState);
}

export async function POST(request: NextRequest) {
  try {
    const body = parseJsonBody(request, await request.text(), contractPauseBodySchema);

    // TODO: verify caller is an authorized guardian via Soroban auth check.
    pauseState = {
      paused: body.paused,
      pausedBy: 'guardian', // replace with verified caller address
      pausedAt: body.paused ? Math.floor(Date.now() / 1000) : undefined,
      reason: body.reason,
    };

    return NextResponse.json(pauseState);
  } catch (error) {
    return (
      handleValidationError(request, error) ??
      apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to update pause state')
    );
  }
}
