/**
 * GET /api/v1/events/search
 *
 * Query params:
 *   productId  – filter by product (required when using KV backend)
 *   text       – full-text search across all fields
 *   location   – substring match on location
 *   actor      – exact match on actor address
 *   eventType  – exact match on event type
 *
 * Authentication: public
 * Rate limiting: publicRead preset
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute, RATE_LIMIT_PRESETS } from '@/lib/api/handler';
import { searchEvents } from '@/lib/indexer/eventIndex';

export const runtime = 'nodejs';

const querySchema = z.object({
  productId: z.string().optional(),
  text: z.string().optional(),
  location: z.string().optional(),
  actor: z.string().optional(),
  eventType: z.string().optional(),
});

export const { GET, OPTIONS } = defineRoute(
  {
    auth: 'public',
    rateLimit: RATE_LIMIT_PRESETS.publicRead,
    query: querySchema,
  },
  {
    GET: async (ctx) => {
      const q = ctx.query as {
        productId?: string;
        text?: string;
        location?: string;
        actor?: string;
        eventType?: string;
      };

      const results = await searchEvents({
        productId: q.productId,
        text: q.text,
        location: q.location,
        actor: q.actor,
        eventType: q.eventType,
      });

      return NextResponse.json({ results, total: results.length });
    },
  },
);
