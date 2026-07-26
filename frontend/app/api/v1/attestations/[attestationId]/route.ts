/**
 * GET    /api/v1/attestations/[attestationId]          — Get attestation details
 * DELETE /api/v1/attestations/[attestationId]          — Revoke an attestation
 *
 * Authentication: public (GET), auditor tier (DELETE)
 * Rate limiting: publicRead (GET), default (DELETE)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute, RATE_LIMIT_PRESETS } from '@/lib/api/handler';
import { apiError, ErrorCode } from '@/lib/api/errors';
import { getAttestation, revokeAttestation } from '@/lib/attestations';

export const runtime = 'nodejs';

// ── Schemas ───────────────────────────────────────────────────────────────────

const paramsSchema = z.object({
  attestationId: z.string().min(1),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

// GET is public — no auth required
const { GET } = defineRoute(
  {
    auth: 'public',
    rateLimit: RATE_LIMIT_PRESETS.publicRead,
    params: paramsSchema,
  },
  {
    GET: async (ctx) => {
      const record = await getAttestation(ctx.params.attestationId);
      if (!record) {
        return apiError(ctx.req, 404, ErrorCode.NOT_FOUND, 'Attestation not found');
      }
      return NextResponse.json(record, { status: 200 });
    },
  },
);

// DELETE requires auditor auth — body is optional
const { DELETE, OPTIONS } = defineRoute(
  {
    auth: 'auditor',
    rateLimit: RATE_LIMIT_PRESETS.default,
    params: paramsSchema,
  },
  {
    DELETE: async (ctx) => {
      const { attestationId } = ctx.params;

      // Caller must identify themselves via x-issuer-address header
      const callerAddress = ctx.req.headers.get('x-issuer-address');
      if (!callerAddress) {
        return apiError(ctx.req, 400, ErrorCode.MISSING_FIELDS, 'Missing x-issuer-address header');
      }

      // Parse body optionally — reason is not required
      let reason: string | undefined;
      try {
        if (ctx.rawBody) {
          const parsed = JSON.parse(ctx.rawBody);
          reason = typeof parsed?.reason === 'string' ? parsed.reason : undefined;
        }
      } catch {
        // body is optional
      }

      const result = await revokeAttestation(attestationId, callerAddress, reason);

      if (!result.success) {
        const status = result.error === 'Attestation not found' ? 404 : 403;
        return apiError(
          ctx.req,
          status,
          ErrorCode.UNAUTHORIZED,
          result.error ?? 'Revocation failed',
        );
      }

      return NextResponse.json(
        { attestationId, revoked: true, revokedAt: Date.now() },
        { status: 200 },
      );
    },
  },
);

export { GET, DELETE, OPTIONS };
