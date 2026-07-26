/**
 * GET /api/v1/products/[id] – get product details with ownership history
 *
 * Authentication: public (no auth required)
 * Rate limiting: publicRead preset
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute, RATE_LIMIT_PRESETS } from '@/lib/api/handler';
import { apiError, ErrorCode } from '@/lib/api/errors';
import { getProductById } from '@/lib/mock/products';

const paramsSchema = z.object({
  id: z.string().min(1),
});

export const { GET, OPTIONS } = defineRoute(
  {
    auth: 'public',
    rateLimit: RATE_LIMIT_PRESETS.publicRead,
    params: paramsSchema,
  },
  {
    GET: async (ctx) => {
      const { id } = ctx.params;

      const product = getProductById(id);
      if (!product) {
        return apiError(ctx.req, 404, ErrorCode.NOT_FOUND, `Product not found: ${id}`);
      }

      return NextResponse.json(product, { status: 200 });
    },
  },
);
