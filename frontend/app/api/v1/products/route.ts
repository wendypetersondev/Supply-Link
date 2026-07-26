/**
 * GET  /api/v1/products     – list all products (paginated)
 * POST /api/v1/products     – register a new product
 *
 * Authentication: partner tier (registry-based API key)
 * Rate limiting: default preset
 * Idempotency: POST requests via Idempotency-Key header
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { defineRoute, RATE_LIMIT_PRESETS } from '@/lib/api/handler';
import { getAllProducts, MOCK_PRODUCTS } from '@/lib/mock/products';
import type { Product, PaginatedResponse } from '@/lib/types';

// ── Schemas ───────────────────────────────────────────────────────────────────

const querySchema = z.object({
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const bodySchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  origin: z.string().trim().min(1, 'origin is required'),
  owner: z.string().trim().min(1, 'owner is required'),
  authorizedActors: z.array(z.string()).optional().default([]),
  requiredSignatures: z.number().int().min(0).optional().default(1),
  imageUrl: z.string().optional(),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

export const { GET, POST, OPTIONS } = defineRoute(
  {
    auth: 'partner',
    rateLimit: RATE_LIMIT_PRESETS.default,
    idempotent: true,
    body: bodySchema,
    query: querySchema,
  },
  {
    GET: async (ctx) => {
      const { offset, limit } = ctx.query;

      const allProducts = getAllProducts();
      const items = allProducts.slice(offset, offset + limit);

      const response: PaginatedResponse<Product> = {
        items,
        total: allProducts.length,
        offset,
        limit,
      };

      return NextResponse.json(response, { status: 200 });
    },

    POST: async (ctx) => {
      const body = ctx.body;

      const newProduct: Product = {
        id: `prod-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: body.name,
        origin: body.origin,
        owner: body.owner,
        timestamp: Date.now(),
        active: true,
        authorizedActors: body.authorizedActors,
        requiredSignatures: body.requiredSignatures,
        imageUrl: body.imageUrl,
        ownershipHistory: [
          {
            owner: body.owner,
            transferredAt: Date.now(),
          },
        ],
      };

      // TODO: Persist to database instead of mock
      MOCK_PRODUCTS.push(newProduct);

      // Notify webhooks of the new product registration
      try {
        const { notifyWebhooksOfProductEvent } = await import('@/lib/webhooks/processor');
        await notifyWebhooksOfProductEvent('product_registered', newProduct.id, {
          product: newProduct,
        });
      } catch (err) {
        console.error('Failed to notify webhooks of product registration:', err);
        // Don't fail the request if webhook notification fails
      }

      return NextResponse.json(newProduct, { status: 201 });
    },
  },
);
