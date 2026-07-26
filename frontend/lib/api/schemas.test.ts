import { describe, expect, it } from 'vitest';
import {
  CONTRACT_LIMITS,
  feeBumpBodySchema,
  productCreateBodySchema,
  productBadgeParamsSchema,
  ratingsBodySchema,
  ratingsQuerySchema,
  trackingEventCreateBodySchema,
  uploadFieldsSchema,
} from '@/lib/api/schemas';

const stellarAddress = `G${'A'.repeat(55)}`;

describe('ratingsBodySchema', () => {
  it('accepts a valid ratings payload', () => {
    const result = ratingsBodySchema.safeParse({
      productId: 'prod-1',
      walletAddress: 'GTESTWALLET',
      stars: 5,
      comment: 'Great',
      message: 'signed-message',
      signature: 'deadbeef',
    });

    expect(result.success).toBe(true);
  });

  it('rejects non-numeric stars without coercion', () => {
    const result = ratingsBodySchema.safeParse({
      productId: 'prod-1',
      walletAddress: 'GTESTWALLET',
      stars: '5',
      message: 'signed-message',
      signature: 'deadbeef',
    });

    expect(result.success).toBe(false);
  });
});

describe('ratingsQuerySchema', () => {
  it('accepts a productId query', () => {
    expect(ratingsQuerySchema.safeParse({ productId: 'prod-1' }).success).toBe(true);
  });

  it('rejects a blank productId query', () => {
    expect(ratingsQuerySchema.safeParse({ productId: ' ' }).success).toBe(false);
  });
});

describe('feeBumpBodySchema', () => {
  it('accepts an innerTx string', () => {
    expect(feeBumpBodySchema.safeParse({ innerTx: 'AAAAAgAAAAA' }).success).toBe(true);
  });

  it('rejects an empty innerTx', () => {
    expect(feeBumpBodySchema.safeParse({ innerTx: '' }).success).toBe(false);
  });
});

describe('uploadFieldsSchema', () => {
  it('accepts an optional productId', () => {
    expect(uploadFieldsSchema.safeParse({ productId: 'prod-1' }).success).toBe(true);
    expect(uploadFieldsSchema.safeParse({}).success).toBe(true);
  });

  it('rejects a blank productId', () => {
    expect(uploadFieldsSchema.safeParse({ productId: ' ' }).success).toBe(false);
  });
});

describe('productBadgeParamsSchema', () => {
  it('accepts a path id', () => {
    expect(productBadgeParamsSchema.safeParse({ id: 'prod-1' }).success).toBe(true);
  });

  it('rejects a blank path id', () => {
    expect(productBadgeParamsSchema.safeParse({ id: '' }).success).toBe(false);
  });
});

describe('contract write schemas', () => {
  it('accepts product strings at their contract boundaries', () => {
    expect(
      productCreateBodySchema.safeParse({
        name: 'n'.repeat(CONTRACT_LIMITS.productName),
        origin: 'o'.repeat(CONTRACT_LIMITS.origin),
        owner: stellarAddress,
      }).success,
    ).toBe(true);
  });

  it('rejects a product name beyond its contract limit', () => {
    expect(
      productCreateBodySchema.safeParse({
        name: 'n'.repeat(CONTRACT_LIMITS.productName + 1),
        origin: 'origin',
        owner: stellarAddress,
      }).success,
    ).toBe(false);
  });

  it('rejects malformed Stellar addresses and unsupported event types', () => {
    expect(
      productCreateBodySchema.safeParse({ name: 'name', origin: 'origin', owner: 'not-an-address' })
        .success,
    ).toBe(false);
    expect(
      trackingEventCreateBodySchema.safeParse({
        eventType: 'UNKNOWN',
        location: 'farm',
        actor: stellarAddress,
        seq: 0,
      }).success,
    ).toBe(false);
  });
});
