import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { handleValidationError, parseJsonBody } from '@/lib/api/validation';

describe('request validation', () => {
  it('maps Zod failures to the canonical VALIDATION_ERROR envelope', () => {
    const request = new NextRequest('http://localhost/api/example', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    });

    let error: unknown;
    try {
      parseJsonBody(request, JSON.stringify({ name: '' }), z.object({ name: z.string().min(1) }));
    } catch (caught) {
      error = caught;
    }

    const response = handleValidationError(request, error);
    expect(response?.status).toBe(400);

    return response!.json().then((body) => {
      expect(body.error.code).toBe('VALIDATION_ERROR');
      expect(body.error.details).toEqual([
        expect.objectContaining({ field: 'name', location: 'body', code: 'too_small' }),
      ]);
    });
  });
});
