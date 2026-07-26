/**
 * Contract tests: one suite, run against every ProductRepository and
 * EventRepository implementation.
 *
 * The contract implementations are driven by `MockContractClient` rather than a
 * live Soroban node, so this exercises the wrapper's mapping without a network.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockContractClient } from '@/lib/stellar/mock-contract-client';
import { MOCK_EVENTS, MOCK_PRODUCTS } from '@/lib/mock/products';
import type { Product, TrackingEvent, WarrantyClaim, WarrantyInfo } from '@/lib/types';
import { ContractEventRepository } from '../contract/event-repository';
import { ContractProductRepository } from '../contract/product-repository';
import { RepositoryUnsupportedError } from '../errors';
import { MockAuditorRepository } from '../mock/auditor-repository';
import { MockEventRepository } from '../mock/event-repository';
import { MockProductRepository } from '../mock/product-repository';
import { createMockStore } from '../mock/store';
import type { EventRepository, ProductRepository } from '../types';

// === Fixtures

const SEED_PRODUCT_ID = 'prod-001';
const SEED_EVENT_PRODUCT_ID = 'prod-001';

function seedProducts(): Product[] {
  return structuredClone(MOCK_PRODUCTS);
}

function seedEvents(): TrackingEvent[] {
  return structuredClone(MOCK_EVENTS);
}

function makeProduct(id: string): Product {
  return {
    id,
    name: 'New Product',
    origin: 'Kenya',
    owner: 'GOWNER',
    timestamp: 1_700_000_000_000,
    active: true,
    authorizedActors: [],
  };
}

function makeWarranty(productId: string): WarrantyInfo {
  return {
    productId,
    durationSeconds: 3600,
    issuer: 'GISSUER',
    issuedAt: 1_700_000_000_000,
    terms: 'Twelve month cover',
    termsRef: 'ipfs://QmTerms',
    voided: false,
    voidedAt: 0,
  };
}

function makeClaim(productId: string): WarrantyClaim {
  return {
    claimId: 'claim-contract-test',
    productId,
    claimant: 'GCLAIMANT',
    filedAt: 1_700_000_000_000,
    description: 'Damaged on arrival',
    proofRef: 'ipfs://QmProof',
    status: 'Pending',
    updatedAt: 1_700_000_000_000,
  };
}

function makeEvent(productId: string): TrackingEvent {
  return {
    productId,
    eventType: 'SHIPPING',
    location: 'Mombasa',
    actor: 'GACTOR',
    timestamp: 1_700_000_000_000,
    metadata: '{}',
  };
}

// === Product repository contract

interface ProductCase {
  name: string;
  create: () => ProductRepository;
  /** Recall has no contract entry point; only the fixture repository has it. */
  supportsRecall: boolean;
}

const productCases: ProductCase[] = [
  {
    name: 'MockProductRepository',
    create: () =>
      new MockProductRepository(
        createMockStore({ products: seedProducts(), events: seedEvents() }),
      ),
    supportsRecall: true,
  },
  {
    name: 'ContractProductRepository',
    create: () => {
      const client = new MockContractClient();
      return new ContractProductRepository(async () => client);
    },
    supportsRecall: false,
  },
];

describe.each(productCases)('ProductRepository contract: $name', (testCase) => {
  let repository: ProductRepository;

  beforeEach(() => {
    repository = testCase.create();
  });

  it('returns a seeded product by id', async () => {
    const product = await repository.getById(SEED_PRODUCT_ID);
    expect(product).not.toBeNull();
    expect(product?.id).toBe(SEED_PRODUCT_ID);
    expect(product?.name).toBe('Organic Coffee Beans');
  });

  it('returns null for an unknown id', async () => {
    expect(await repository.getById('does-not-exist')).toBeNull();
  });

  it('reports a total independent of the requested page', async () => {
    const firstPage = await repository.list({ offset: 0, limit: 2 });
    const secondPage = await repository.list({ offset: 2, limit: 2 });

    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.total).toBe(secondPage.total);
    expect(firstPage.total).toBeGreaterThanOrEqual(3);
    expect(firstPage.items[0].id).not.toBe(secondPage.items[0]?.id);
  });

  it('lists every product', async () => {
    const all = await repository.listAll();
    const page = await repository.list({ offset: 0, limit: 1 });
    expect(all).toHaveLength(page.total);
  });

  it('makes a created product readable', async () => {
    const created = await repository.create(makeProduct('prod-contract-test'));
    expect(created.id).toBe('prod-contract-test');

    const readBack = await repository.getById('prod-contract-test');
    expect(readBack?.name).toBe('New Product');
  });

  it('persists a registered warranty', async () => {
    await repository.setWarranty(SEED_PRODUCT_ID, makeWarranty(SEED_PRODUCT_ID));

    const product = await repository.getById(SEED_PRODUCT_ID);
    expect(product?.warranty?.terms).toBe('Twelve month cover');
  });

  it('appends a warranty claim', async () => {
    await repository.setWarranty(SEED_PRODUCT_ID, makeWarranty(SEED_PRODUCT_ID));
    await repository.addWarrantyClaim(SEED_PRODUCT_ID, makeClaim(SEED_PRODUCT_ID));

    const product = await repository.getById(SEED_PRODUCT_ID);
    const claimIds = (product?.warrantyClaims ?? []).map((c) => c.claimId);
    expect(claimIds).toContain('claim-contract-test');
  });

  it('persists a registered assembly', async () => {
    await repository.setAssembly(SEED_PRODUCT_ID, {
      parentId: SEED_PRODUCT_ID,
      componentIds: ['prod-002'],
      registeredBy: 'GOWNER',
      registeredAt: 1_700_000_000_000,
      description: 'Repackaged',
    });

    const product = await repository.getById(SEED_PRODUCT_ID);
    expect(product?.assembly?.componentIds).toEqual(['prod-002']);
  });

  it('handles recall according to what the source supports', async () => {
    if (!testCase.supportsRecall) {
      await expect(repository.recall(SEED_PRODUCT_ID, 'contamination', 1)).rejects.toBeInstanceOf(
        RepositoryUnsupportedError,
      );
      return;
    }

    await repository.recall(SEED_PRODUCT_ID, 'contamination', 1_700_000_000);

    const product = await repository.getById(SEED_PRODUCT_ID);
    expect(product?.recalled).toBe(true);
    expect(product?.recallReason).toBe('contamination');
  });
});

// === Event repository contract

interface EventCase {
  name: string;
  create: () => EventRepository;
  /** The contract has no cross-product event enumeration. */
  supportsListAll: boolean;
}

const eventCases: EventCase[] = [
  {
    name: 'MockEventRepository',
    create: () =>
      new MockEventRepository(createMockStore({ products: seedProducts(), events: seedEvents() })),
    supportsListAll: true,
  },
  {
    name: 'ContractEventRepository',
    create: () => {
      const client = new MockContractClient();
      return new ContractEventRepository(async () => client);
    },
    supportsListAll: false,
  },
];

describe.each(eventCases)('EventRepository contract: $name', (testCase) => {
  let repository: EventRepository;

  beforeEach(() => {
    repository = testCase.create();
  });

  it('returns only the events of the requested product', async () => {
    const events = await repository.listByProduct(SEED_EVENT_PRODUCT_ID);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.productId === SEED_EVENT_PRODUCT_ID)).toBe(true);
  });

  it('returns an empty list for a product with no events', async () => {
    expect(await repository.listByProduct('does-not-exist')).toEqual([]);
  });

  it('makes an appended event readable', async () => {
    const before = await repository.listByProduct(SEED_EVENT_PRODUCT_ID);
    await repository.append(makeEvent(SEED_EVENT_PRODUCT_ID));

    const after = await repository.listByProduct(SEED_EVENT_PRODUCT_ID);
    expect(after).toHaveLength(before.length + 1);
    expect(after.some((e) => e.location === 'Mombasa')).toBe(true);
  });

  it('handles listAll according to what the source supports', async () => {
    if (!testCase.supportsListAll) {
      await expect(repository.listAll()).rejects.toBeInstanceOf(RepositoryUnsupportedError);
      return;
    }

    const all = await repository.listAll();
    const forProduct = await repository.listByProduct(SEED_EVENT_PRODUCT_ID);
    expect(all.length).toBeGreaterThanOrEqual(forProduct.length);
  });
});

// === Auditor repository

describe('MockAuditorRepository', () => {
  const auditors = [
    { address: 'GA1', name: 'Active Auditor', active: true, registeredAt: 1 },
    { address: 'GA2', name: 'Retired Auditor', active: false, registeredAt: 2 },
  ];

  const batches = [
    {
      id: 'batch-1',
      name: 'Batch One',
      owner: 'GOWNER',
      productIds: ['prod-001'],
      timestamp: 1,
      recalled: false,
      recallReason: '',
      recallTimestamp: 0,
    },
  ];

  const attestations = [
    {
      id: 'att-1',
      productId: 'prod-001',
      targetId: '',
      auditor: 'GA1',
      attestationType: 'quality_check',
      signature: 'sig',
      timestamp: 1,
    },
    {
      id: 'att-2',
      productId: 'prod-001',
      targetId: 'event-1',
      auditor: 'GA1',
      attestationType: 'compliance_verified',
      signature: 'sig',
      timestamp: 2,
    },
  ];

  let repository: MockAuditorRepository;

  beforeEach(() => {
    repository = new MockAuditorRepository(
      createMockStore({
        auditors: structuredClone(auditors),
        batches: structuredClone(batches),
        attestations: structuredClone(attestations),
      }),
    );
  });

  it('filters inactive auditors when activeOnly is set', async () => {
    expect(await repository.list()).toHaveLength(2);
    expect(await repository.list({ activeOnly: true })).toHaveLength(1);
  });

  it('finds and creates auditors by address', async () => {
    expect(await repository.getByAddress('GA1')).toMatchObject({ name: 'Active Auditor' });
    expect(await repository.getByAddress('GA9')).toBeNull();

    await repository.create({ address: 'GA9', name: 'New Auditor', active: true, registeredAt: 3 });
    expect(await repository.getByAddress('GA9')).not.toBeNull();
  });

  it('separates product-level from event-level attestations', async () => {
    expect(await repository.listAttestationsByProduct('prod-001')).toHaveLength(2);
    expect(await repository.listAttestationsByTarget('prod-001', 'event-1')).toHaveLength(1);
  });

  it('marks a batch as recalled', async () => {
    expect(await repository.getBatch('missing')).toBeNull();

    const recalled = await repository.recallBatch('batch-1', 'contamination', 1_700_000_000);
    expect(recalled).toMatchObject({ recalled: true, recallReason: 'contamination' });

    const readBack = await repository.getBatch('batch-1');
    expect(readBack?.recalled).toBe(true);
  });

  it('lists batches containing a product', async () => {
    expect(await repository.listBatchesByProduct('prod-001')).toHaveLength(1);
    expect(await repository.listBatchesByProduct('prod-999')).toHaveLength(0);
  });
});
