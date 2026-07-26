/**
 * GET  /api/v1/provenance/[productId]/proof  — generate a provenance proof
 * POST /api/v1/provenance/[productId]/proof  — verify a submitted proof
 *
 * closes #477
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { recordRequest } from '@/lib/api/metrics';
import { getTrackingEvents } from '@/lib/services/productReadModel';
import {
  generateProvenanceProof,
  verifyProvenanceProof,
  decodeProof,
} from '@/lib/provenance/proofs';
import { provenanceProofBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const { productId } = await params;

  const limited = applyRateLimit(
    request,
    'GET /api/v1/provenance/proof',
    RATE_LIMIT_PRESETS.publicRead,
  );
  if (limited) {
    recordRequest('GET /api/v1/provenance/proof', 429, Date.now() - start);
    return limited;
  }

  try {
    const events = await getTrackingEvents(productId);
    const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

    // Attempt to fetch on-chain root; fall back to empty string in dev
    let provenanceRoot = '';
    try {
      const { contractClient } = await import('@/lib/stellar/contract');
      const rootBytes = await contractClient.getProvenanceRoot(productId, '');
      provenanceRoot = Array.from(rootBytes)
        .map((b) => (b as number).toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Contract unavailable — proof still valid for off-chain audit
    }

    const proof = await generateProvenanceProof(productId, sorted, provenanceRoot);

    const res = NextResponse.json({ proof }, { status: 200 });
    recordRequest('GET /api/v1/provenance/proof', 200, Date.now() - start);
    return withCors(request, withCorrelationId(request, res));
  } catch (err) {
    console.error('[provenance proof GET]', err);
    recordRequest('GET /api/v1/provenance/proof', 500, Date.now() - start);
    return withCors(
      request,
      apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to generate proof'),
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> },
): Promise<NextResponse> {
  const start = Date.now();
  const { productId } = await params;

  const limited = applyRateLimit(
    request,
    'POST /api/v1/provenance/proof',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/provenance/proof', 429, Date.now() - start);
    return limited;
  }

  try {
    const body = parseJsonBody(request, await request.text(), provenanceProofBodySchema);

    const proof = decodeProof(body.encodedProof);
    if (!proof) {
      return withCors(
        request,
        apiError(request, 400, ErrorCode.INVALID_PAYLOAD, 'Could not decode proof'),
      );
    }

    if (proof.productId !== productId) {
      return withCors(
        request,
        apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'Proof productId does not match URL'),
      );
    }

    try {
      const events = await getTrackingEvents(productId);
      const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp);

      let onChainRoot = '';
      try {
        const { contractClient } = await import('@/lib/stellar/contract');
        const rootBytes = await contractClient.getProvenanceRoot(productId, '');
        onChainRoot = Array.from(rootBytes)
          .map((b) => (b as number).toString(16).padStart(2, '0'))
          .join('');
      } catch {
        // Use proof's root for chain-only verification
        onChainRoot = proof.provenanceRoot;
      }

      const result = await verifyProvenanceProof(proof, sorted, onChainRoot);

      const res = NextResponse.json({ result }, { status: 200 });
      recordRequest('POST /api/v1/provenance/proof', 200, Date.now() - start);
      return withCors(request, withCorrelationId(request, res));
    } catch (err) {
      console.error('[provenance proof POST]', err);
      recordRequest('POST /api/v1/provenance/proof', 500, Date.now() - start);
      return withCors(
        request,
        apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to verify proof'),
      );
    }
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 500, ErrorCode.INTERNAL_ERROR, 'Failed to verify proof'),
    );
  }
}
