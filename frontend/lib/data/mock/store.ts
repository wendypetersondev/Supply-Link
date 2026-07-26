/**
 * Single shared in-memory store backing the mock repositories.
 *
 * The fixture arrays in `@/lib/mock/*` are mutated in place rather than copied:
 * `MockContractClient` and the client-side hooks read the same arrays, so a
 * copy here would let repository writes and those readers drift apart within a
 * process. This module is the only place outside `@/lib/mock` allowed to write
 * to them.
 *
 * Tests can pass their own `MockStore` to any mock repository instead of
 * mocking the fixture module.
 */

import { MOCK_EVENTS, MOCK_PRODUCTS } from '@/lib/mock/products';
import { MOCK_ATTESTATIONS, MOCK_AUDITORS, MOCK_BATCHES } from '@/lib/mock/auditors';
import type { Attestation, Auditor, BatchWithRecall, Product, TrackingEvent } from '@/lib/types';

export interface MockStore {
  products: Product[];
  events: TrackingEvent[];
  auditors: Auditor[];
  attestations: Attestation[];
  batches: BatchWithRecall[];
}

export const mockStore: MockStore = {
  products: MOCK_PRODUCTS,
  events: MOCK_EVENTS,
  auditors: MOCK_AUDITORS,
  attestations: MOCK_ATTESTATIONS,
  batches: MOCK_BATCHES,
};

/** Build a store from partial seed data, defaulting every collection to empty. */
export function createMockStore(seed: Partial<MockStore> = {}): MockStore {
  return {
    products: seed.products ?? [],
    events: seed.events ?? [],
    auditors: seed.auditors ?? [],
    attestations: seed.attestations ?? [],
    batches: seed.batches ?? [],
  };
}

/**
 * Replace a product in place, preserving its position in the array.
 * Returns the stored product, or null when the id is unknown.
 */
export function replaceProduct(
  store: MockStore,
  productId: string,
  next: (current: Product) => Product,
): Product | null {
  const idx = store.products.findIndex((p) => p.id === productId);
  if (idx === -1) return null;
  const updated = next(store.products[idx]);
  store.products[idx] = updated;
  return updated;
}
