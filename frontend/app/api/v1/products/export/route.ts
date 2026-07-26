/**
 * POST /api/v1/products/export – export product timeline for regulatory reporting
 *
 * Request body:
 * {
 *   "productIds": ["prod-001"],
 *   "format": "json" | "csv"
 * }
 *
 * Response: File download (application/json or text/csv)
 */

import { NextRequest, NextResponse } from 'next/server';
import { withCors, handleOptions } from '@/lib/api/cors';
import { apiError, withCorrelationId, ErrorCode } from '@/lib/api/errors';
import { applyRateLimit, RATE_LIMIT_PRESETS } from '@/lib/api/rateLimit';
import { authenticateApiRequest } from '@/lib/api/auth';
import { generateTimelineExport, generateBatchExport } from '@/lib/services/exportService';
import { getEventRepository, getProductRepository } from '@/lib/data';
import { recordRequest } from '@/lib/api/metrics';
import { productExportBodySchema } from '@/lib/api/schemas';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

export function OPTIONS(request: NextRequest) {
  return handleOptions(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const start = Date.now();

  const limited = applyRateLimit(
    request,
    'POST /api/v1/products/export',
    RATE_LIMIT_PRESETS.default,
  );
  if (limited) {
    recordRequest('POST /api/v1/products/export', 429, Date.now() - start);
    return limited;
  }

  const auth = await authenticateApiRequest(request, 'partner');
  if (auth.error) {
    recordRequest('POST /api/v1/products/export', 401, Date.now() - start);
    return auth.error;
  }

  try {
    const body = parseJsonBody(request, await request.text(), productExportBodySchema);
    const format = body.format;
    const products = body.productIds.map((id) => getProductById(id)).filter((p) => p !== undefined);
    if (products.length === 0)
      return apiError(request, 400, ErrorCode.VALIDATION_ERROR, 'No valid products found');
    let content: string;
    let filename: string;
    if (products.length === 1) {
      const exp = generateTimelineExport(products[0], MOCK_EVENTS, format);
      content =
        format === 'json'
          ? JSON.stringify(exp, null, 2)
          : generateBatchExport(products, MOCK_EVENTS, format);
      filename = `timeline-${products[0].id}-${Date.now()}.${format}`;
    } else {
      content = generateBatchExport(products, MOCK_EVENTS, format);
      filename = `timeline-batch-${Date.now()}.${format}`;
    }
    recordRequest('POST /api/v1/products/export', 200, Date.now() - start);
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': format === 'json' ? 'application/json' : 'text/csv',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  } catch (error) {
    return withCors(
      request,
      handleValidationError(request, error) ??
        apiError(request, 400, ErrorCode.INVALID_PAYLOAD, 'Invalid request'),
    );
  }
}
