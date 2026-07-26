/**
 * Repository factory. Route handlers and services import from here only.
 *
 * `DATA_SOURCE` (or NEXT_PUBLIC_DATA_SOURCE for client bundles) selects the
 * backing implementation for products and events. Flipping it to `contract`
 * routes every product and event read through the Soroban contract without any
 * call site changing.
 *
 * Auditors, attestations and batches have no on-chain registry yet, so they
 * always resolve to the mock repository.
 */

import { ContractEventRepository } from './contract/event-repository';
import { ContractProductRepository } from './contract/product-repository';
import { MockAuditorRepository } from './mock/auditor-repository';
import { MockEventRepository } from './mock/event-repository';
import { MockProductRepository } from './mock/product-repository';
import type { AuditorRepository, DataSource, EventRepository, ProductRepository } from './types';

export * from './types';
export { RepositoryUnsupportedError } from './errors';
export { createMockStore, mockStore, type MockStore } from './mock/store';
export { MockAuditorRepository, MockEventRepository, MockProductRepository };
export { ContractEventRepository, ContractProductRepository };

export function getDataSource(): DataSource {
  const configured = process.env.DATA_SOURCE ?? process.env.NEXT_PUBLIC_DATA_SOURCE;
  return configured === 'contract' ? 'contract' : 'mock';
}

let productRepository: ProductRepository | null = null;
let eventRepository: EventRepository | null = null;
let auditorRepository: AuditorRepository | null = null;
let resolvedSource: DataSource | null = null;

/** Drop cached instances when the configured source changes (tests, config reload). */
function invalidateIfSourceChanged(source: DataSource): void {
  if (resolvedSource === source) return;
  resolvedSource = source;
  productRepository = null;
  eventRepository = null;
}

export function getProductRepository(): ProductRepository {
  const source = getDataSource();
  invalidateIfSourceChanged(source);
  productRepository ??=
    source === 'contract' ? new ContractProductRepository() : new MockProductRepository();
  return productRepository;
}

export function getEventRepository(): EventRepository {
  const source = getDataSource();
  invalidateIfSourceChanged(source);
  eventRepository ??=
    source === 'contract' ? new ContractEventRepository() : new MockEventRepository();
  return eventRepository;
}

export function getAuditorRepository(): AuditorRepository {
  auditorRepository ??= new MockAuditorRepository();
  return auditorRepository;
}
