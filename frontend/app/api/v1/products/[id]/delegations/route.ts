/**
 * GET  /api/v1/products/[id]/delegations  – list active delegations
 * POST /api/v1/products/[id]/delegations  – create a delegation
 *
 * Authentication: x-api-key (partner or internal)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { authenticateApiRequest } from '@/lib/api/auth';
import { getProductRepository } from '@/lib/data';
import { recordApprovalEvent } from '@/lib/api/approvalLog';
import { delegationStore } from '@/lib/services/delegationStore';
import { delegationCreateBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';
import type { Delegation } from '@/lib/types';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!(await getProductRepository().getById(id))) {
    return apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${id}`);
  }

  const now = Math.floor(Date.now() / 1000);
  const active = delegationStore.list(id).filter((d) => !d.revoked && d.expiresAt > now);
  return withCors(request, withCorrelationId(request, NextResponse.json(active, { status: 200 })));
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) return auth.error;

  const { id } = await params;
  if (!(await getProductRepository().getById(id))) {
    return apiError(request, 404, ErrorCode.VALIDATION_ERROR, `Product not found: ${id}`);
  }

  try {
    const body = parseJsonBody(request, await request.text(), delegationCreateBodySchema);
    if (body.expiresAt <= Math.floor(Date.now() / 1000)) {
      return apiError(
        request,
        400,
        ErrorCode.VALIDATION_ERROR,
        'expiresAt must be a future timestamp',
      );
    }

    const delegation: Delegation = {
      delegationId: Date.now(),
      productId: id,
      delegator: auth.apiKey ?? 'unknown',
      delegatee: body.delegatee,
      expiresAt: body.expiresAt,
      revoked: false,
      createdAt: Math.floor(Date.now() / 1000),
    };

    delegationStore.add(delegation);

    recordApprovalEvent({
      action: 'delegate_actor_authority',
      productId: id,
      actor: delegation.delegator,
      target: delegation.delegatee,
      success: true,
    });

    return withCors(
      request,
      withCorrelationId(request, NextResponse.json(delegation, { status: 201 })),
    );
  } catch (error) {
    return (
      handleValidationError(request, error) ??
      apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to create delegation')
    );
  }
}
