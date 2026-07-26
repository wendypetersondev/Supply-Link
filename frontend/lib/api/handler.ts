/**
 * Composable route handler factory — eliminates boilerplate across all 86 API routes.
 *
 * Usage:
 *   export const { GET, POST, OPTIONS } = defineRoute({
 *     auth: 'partner',
 *     rateLimit: RATE_LIMIT_PRESETS.default,
 *     body: z.object({ name: z.string() }),
 *   }, {
 *     GET: async (ctx) => NextResponse.json({ items: [] }),
 *     POST: async (ctx) => NextResponse.json(ctx.body, { status: 201 }),
 *   });
 *
 * The factory automatically handles:
 *   - CORS (preflight + response headers)
 *   - Correlation ID propagation
 *   - Rate limiting (IP-based with reputation)
 *   - Authentication (registry-based API keys)
 *   - Idempotency for mutation endpoints
 *   - JSON body parsing & Zod validation
 *   - Query parameter parsing & Zod validation
 *   - Path parameter parsing & Zod validation
 *   - Error → HTTP mapping (RequestValidationError, unknown errors)
 *   - API version headers
 *   - Metrics recording
 *
 * @see docs/adr/ for architectural decisions
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, type RateLimitConfig, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateRegistryKey } from '@/lib/api/apiKeyAuth';
import type { ApiKeyTier } from '@/lib/api/apiKeyRegistry';
import { withIdempotency } from '@/lib/api/idempotency';
import { recordRequest } from '@/lib/api/metrics';
import { getCorrelationId } from '@/lib/api/correlation';
import {
  parseJsonBody,
  parseQuery,
  parsePathParams,
  handleValidationError,
} from '@/lib/api/validation';
import { withApiVersion } from '@/lib/api/versioning';

// ── Re-exports for convenience ────────────────────────────────────────────────

export { RATE_LIMIT_PRESETS };
export type { RateLimitConfig };

// ── Public types ──────────────────────────────────────────────────────────────

/** Authentication tier for a route. */
export type AuthTier = ApiKeyTier | 'public';

/** Configuration for a route group. */
export interface RouteConfig<Body = unknown, Query = unknown, Params = unknown> {
  /** Authentication tier. 'public' = no auth required. Default: 'public' */
  auth?: AuthTier;
  /** IP-based rate-limit config. Pass `false` to disable. Default: RATE_LIMIT_PRESETS.default */
  rateLimit?: RateLimitConfig | false;
  /** Enable idempotency for POST/PUT/PATCH methods. Default: false */
  idempotent?: boolean;
  /** Enable CORS headers and OPTIONS preflight. Default: true */
  cors?: boolean;
  /** Zod schema for the JSON request body (POST/PUT/PATCH) */
  body?: z.ZodType<Body>;
  /** Zod schema for query parameters */
  query?: z.ZodType<Query>;
  /** Zod schema for path parameters (dynamic route segments) */
  params?: z.ZodType<Params>;
  /**
   * Stable endpoint identifier for rate-limit counters and metrics.
   * Auto-derived from `{method} {pathname}` if omitted.
   */
  endpoint?: string;
  /**
   * Optional deprecation config. When set, responses include
   * Deprecation + Sunset headers per RFC 8594.
   */
  deprecated?: {
    sunsetDate: string;
    successorUrl?: string;
  };
}

/**
 * Typed context passed to every route handler.
 * Body, Query, and Params are validated by the factory before
 * the handler runs, so they are always safe to use.
 */
export interface HandlerContext<Body = unknown, Query = unknown, Params = unknown> {
  /** The raw incoming request */
  req: NextRequest;
  /** Parsed & validated JSON body (undefined for GET/DELETE unless schema provided) */
  body: Body;
  /** Parsed & validated query parameters */
  query: Query;
  /** Parsed & validated path parameters */
  params: Params;
  /** Authenticated API key (undefined for public routes) */
  apiKey?: string;
  /** The authenticated key's tier (undefined for public routes) */
  tier?: ApiKeyTier;
  /** Correlation ID for this request */
  correlationId: string;
  /** Raw request body as a string (useful for webhook signature verification etc.) */
  rawBody: string;
}

/** Signature for a method handler. */
export type RouteHandler<Body = unknown, Query = unknown, Params = unknown> = (
  ctx: HandlerContext<Body, Query, Params>,
) => NextResponse | Promise<NextResponse>;

/** Map of HTTP methods to their handlers. All methods are optional. */
export interface RouteHandlers<Body = unknown, Query = unknown, Params = unknown> {
  GET?: RouteHandler<Body, Query, Params>;
  POST?: RouteHandler<Body, Query, Params>;
  PUT?: RouteHandler<Body, Query, Params>;
  DELETE?: RouteHandler<Body, Query, Params>;
  PATCH?: RouteHandler<Body, Query, Params>;
}

/** The exported handler functions. Destructure to get named exports. */
export interface RouteExports {
  GET?: (request: NextRequest, opts?: { params?: Promise<unknown> }) => Promise<NextResponse>;
  POST?: (request: NextRequest, opts?: { params?: Promise<unknown> }) => Promise<NextResponse>;
  PUT?: (request: NextRequest, opts?: { params?: Promise<unknown> }) => Promise<NextResponse>;
  DELETE?: (request: NextRequest, opts?: { params?: Promise<unknown> }) => Promise<NextResponse>;
  PATCH?: (request: NextRequest, opts?: { params?: Promise<unknown> }) => Promise<NextResponse>;
  OPTIONS?: (request: NextRequest) => NextResponse;
}

// ── HTTP methods that can have a body ─────────────────────────────────────────

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH']);

// ── Factory implementation ────────────────────────────────────────────────────

/**
 * Create a set of route handlers with automatic cross-cutting concerns.
 *
 * @example
 *   export const { GET, POST, OPTIONS } = defineRoute({
 *     auth: 'partner',
 *     rateLimit: RATE_LIMIT_PRESETS.default,
 *     body: z.object({ name: z.string() }),
 *   }, {
 *     GET: async (ctx) => NextResponse.json({ items: [] }),
 *     POST: async (ctx) => NextResponse.json(ctx.body, { status: 201 }),
 *   });
 */
export function defineRoute<Body = unknown, Query = unknown, Params = unknown>(
  config: RouteConfig<Body, Query, Params>,
  handlers: RouteHandlers<Body, Query, Params>,
): RouteExports {
  const {
    auth = 'public',
    rateLimit = RATE_LIMIT_PRESETS.default,
    idempotent = false,
    cors = true,
    body: bodySchema,
    query: querySchema,
    params: paramsSchema,
    endpoint: customEndpoint,
    deprecated,
  } = config;

  const result: RouteExports = {};

  // ── OPTIONS handler ──────────────────────────────────────────────────────

  if (cors) {
    result.OPTIONS = (request: NextRequest) => handleOptions(request);
  }

  // ── Helper: create a wrapped handler ────────────────────────────────────

  // ── Helper: wrap early-return responses with standard headers ─────────

  function wrapEarlyResponse(response: NextResponse): NextResponse {
    return withApiVersion(response);
  }

  function createWrappedHandler(
    methodUpper: string,
    handler: RouteHandler<Body, Query, Params>,
  ): (request: NextRequest, opts?: { params?: Promise<unknown> }) => Promise<NextResponse> {
    return async (request, opts) => {
      const start = Date.now();
      const endpoint = customEndpoint ?? `${methodUpper} ${request.nextUrl.pathname}`;

      try {
        // ── 1. Rate limiting ───────────────────────────────────────────
        if (rateLimit) {
          const limited = applyRateLimit(request, endpoint, rateLimit);
          if (limited) {
            recordRequest(endpoint, 429, Date.now() - start);
            return wrapEarlyResponse(limited);
          }
        }

        // ── 2. Authentication ──────────────────────────────────────────
        let apiKey: string | undefined;
        let tier: ApiKeyTier | undefined;
        if (auth !== 'public') {
          const authResult = await authenticateRegistryKey(request, auth, endpoint);
          if (authResult.error) {
            recordRequest(endpoint, authResult.error.status, Date.now() - start);
            return wrapEarlyResponse(authResult.error);
          }
          apiKey = authResult.keyId;
          tier = authResult.tier;
        }

        // ── 3. Parse query parameters ─────────────────────────────────
        let parsedQuery: Query = undefined as unknown as Query;
        if (querySchema) {
          parsedQuery = parseQuery(request, querySchema);
        }

        // ── 4. Parse path parameters ──────────────────────────────────
        let parsedParams: Params = undefined as unknown as Params;
        if (paramsSchema && opts?.params) {
          parsedParams = await parsePathParams(opts.params, paramsSchema);
        }

        // ── 5. Execute handler (with or without idempotency) ──────────
        const correlationId = getCorrelationId(request);
        const isWrite = WRITE_METHODS.has(methodUpper);
        const shouldWrapIdempotency = isWrite && idempotent;

        const executeHandler = async (req: NextRequest, rawBody: string): Promise<NextResponse> => {
          let parsedBody: Body = undefined as unknown as Body;
          if (bodySchema && isWrite) {
            parsedBody = parseJsonBody(req, rawBody, bodySchema);
          }

          const ctx: HandlerContext<Body, Query, Params> = {
            req,
            body: parsedBody,
            query: parsedQuery,
            params: parsedParams,
            apiKey,
            tier,
            correlationId,
            rawBody,
          };

          const response = await Promise.resolve(handler(ctx));

          // Wrap with CORS, correlation ID, and API version
          let wrapped = response;
          wrapped = withApiVersion(wrapped);
          if (cors) {
            wrapped = withCors(req, wrapped);
          }
          wrapped.headers.set('X-Correlation-Id', correlationId);

          if (deprecated) {
            wrapped.headers.set('Deprecation', 'true');
            wrapped.headers.set('Sunset', new Date(deprecated.sunsetDate).toUTCString());
            if (deprecated.successorUrl) {
              wrapped.headers.set('Link', `<${deprecated.successorUrl}>; rel="successor-version"`);
            }
          }

          return wrapped;
        };

        let response: NextResponse;
        if (shouldWrapIdempotency) {
          response = await withIdempotency(request, executeHandler);
        } else {
          const rawBody = isWrite ? await request.text() : '';
          response = await executeHandler(request, rawBody);
        }

        recordRequest(endpoint, response.status, Date.now() - start);
        return response;
      } catch (error: unknown) {
        const duration = Date.now() - start;

        // Handle validation errors specially
        const validationResponse = handleValidationError(request, error);
        if (validationResponse) {
          recordRequest(endpoint, validationResponse.status, duration);
          return validationResponse;
        }

        // Handle unexpected errors
        console.error(
          `[handler] unhandled error in ${endpoint}`,
          error instanceof Error ? error.message : error,
        );

        const errorResponse = apiError(
          request,
          500,
          ErrorCode.INTERNAL_ERROR,
          error instanceof Error ? error.message : 'Internal server error',
        );

        recordRequest(endpoint, 500, duration);
        return cors ? withCors(request, errorResponse) : errorResponse;
      }
    };
  }

  // ── Assign wrapped handlers to the result object ───────────────────────

  if (handlers.GET) result.GET = createWrappedHandler('GET', handlers.GET);
  if (handlers.POST) result.POST = createWrappedHandler('POST', handlers.POST);
  if (handlers.PUT) result.PUT = createWrappedHandler('PUT', handlers.PUT);
  if (handlers.DELETE) result.DELETE = createWrappedHandler('DELETE', handlers.DELETE);
  if (handlers.PATCH) result.PATCH = createWrappedHandler('PATCH', handlers.PATCH);

  return result;
}
