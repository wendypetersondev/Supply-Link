/**
 * POST /api/v1/attestations  — Add an attestation to a product
 * GET  /api/v1/attestations  — List attestations (by productId or issuerAddress)
 *
 * Authentication: public (GET), auditor tier or higher (POST)
 * Rate limiting: publicRead (GET), default (POST)
 * Idempotency: POST requests via Idempotency-Key header
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute, RATE_LIMIT_PRESETS } from '@/lib/api/handler';
import { apiError, ErrorCode } from '@/lib/api/errors';
import {
  addAttestation,
  listAttestationsForProduct,
  listAttestationsByIssuer,
} from '@/lib/attestations';

export const runtime = 'nodejs';

// ── Schemas ───────────────────────────────────────────────────────────────────

const addAttestationSchema = z.object({
  productId: z
    .string()
    .trim()
    .min(1, 'productId is required')
    .max(128, 'productId must be 128 characters or fewer'),
  issuerAddress: z
    .string()
    .trim()
    .min(1, 'issuerAddress is required')
    .max(256, 'issuerAddress must be 256 characters or fewer'),
  issuerName: z
    .string()
    .trim()
    .min(1, 'issuerName is required')
    .max(256, 'issuerName must be 256 characters or fewer'),
  trustLevel: z.enum(['verified', 'trusted', 'community'] as const),
  attestationType: z.enum([
    'audit',
    'certification',
    'inspection',
    'compliance',
    'sustainability',
    'custom',
  ] as const),
  summary: z
    .string()
    .trim()
    .min(1, 'summary is required')
    .max(512, 'summary must be 512 characters or fewer'),
  signedReference: z
    .string()
    .trim()
    .min(1, 'signedReference is required')
    .max(2048, 'signedReference must be 2048 characters or fewer'),
  reportUrl: z.string().url('reportUrl must be a valid URL').optional(),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
  metadata: z.string().max(4096, 'metadata must be 4096 characters or fewer').optional(),
});

const querySchema = z.object({
  productId: z.string().optional(),
  issuerAddress: z.string().optional(),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

// GET is public — no auth required
const { GET } = defineRoute(
  {
    auth: 'public',
    rateLimit: RATE_LIMIT_PRESETS.publicRead,
    query: querySchema,
  },
  {
    GET: async (ctx) => {
      const { productId, issuerAddress } = ctx.query as {
        productId?: string;
        issuerAddress?: string;
      };

      if (!productId && !issuerAddress) {
        return apiError(
          ctx.req,
          400,
          ErrorCode.VALIDATION_ERROR,
          'Provide either productId or issuerAddress query parameter',
        );
      }

      const attestations = productId
        ? await listAttestationsForProduct(productId)
        : await listAttestationsByIssuer(issuerAddress!);

      return NextResponse.json({ attestations, total: attestations.length }, { status: 200 });
    },
  },
);

// POST requires auditor auth + idempotency
const { POST, OPTIONS } = defineRoute(
  {
    auth: 'auditor',
    rateLimit: RATE_LIMIT_PRESETS.default,
    idempotent: true,
    body: addAttestationSchema,
  },
  {
    POST: async (ctx) => {
      const record = await addAttestation(ctx.body);
      return NextResponse.json(record, { status: 201 });
    },
  },
);

export { GET, POST, OPTIONS };
