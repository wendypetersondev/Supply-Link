/**
 * GET /api/v1/events/export?productId=<id>
 *
 * Export a product's full event history in the Supply-Link interchange format.
 *
 * Query params:
 *   productId  (required) — product to export
 *   offset     (optional) — pagination offset, default 0
 *   limit      (optional) — max events per page, default 100, max 500
 *   format     (optional) — "json" (default) | "jsonld"
 *
 * Authentication: partner tier or higher (registry-based API key)
 * Rate limiting: publicRead preset (elevated to authenticated for wallet users)
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute, RATE_LIMIT_PRESETS } from '@/lib/api/handler';
import { apiError, ErrorCode } from '@/lib/api/errors';
import { getProductById, getEventsByProductId } from '@/lib/mock/products';
import { buildInterchangePayload } from '@/lib/interchange/eventExporter';

export const runtime = 'nodejs';

const querySchema = z.object({
  productId: z.string().min(1, 'productId query parameter is required'),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  format: z.enum(['json', 'jsonld']).default('json'),
});

export const { GET, OPTIONS } = defineRoute(
  {
    auth: 'partner',
    rateLimit: RATE_LIMIT_PRESETS.publicRead,
    query: querySchema,
  },
  {
    GET: async (ctx) => {
      const { productId, offset, limit, format } = ctx.query as {
        productId: string;
        offset: number;
        limit: number;
        format: string;
      };

      const product = getProductById(productId);
      if (!product) {
        return apiError(ctx.req, 404, ErrorCode.NOT_FOUND, `Product '${productId}' not found`);
      }

      // Fetch events sorted oldest-first (canonical provenance order)
      const allEvents = getEventsByProductId(productId).sort((a, b) => a.timestamp - b.timestamp);

      const payload = buildInterchangePayload(product, allEvents, { offset, limit });

      const contentType = format === 'jsonld' ? 'application/ld+json' : 'application/json';

      return NextResponse.json(payload, {
        status: 200,
        headers: { 'Content-Type': contentType },
      });
    },
  },
);
