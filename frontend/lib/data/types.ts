/**
 * Repository interfaces for product, event and auditor data.
 *
 * Route handlers and services depend on these interfaces only. The concrete
 * source (in-memory fixtures or the Soroban contract) is resolved by the
 * factory in `@/lib/data`, so swapping data sources never touches call sites.
 */

import type {
  Attestation,
  Auditor,
  BatchWithRecall,
  Product,
  ProductAssembly,
  TrackingEvent,
  WarrantyClaim,
  WarrantyInfo,
} from '@/lib/types';

// === Shared

export interface PageOptions {
  offset: number;
  limit: number;
}

export interface Page<T> {
  items: T[];
  total: number;
}

/** Which backing implementation the factory should resolve. */
export type DataSource = 'mock' | 'contract';

// === Products

export interface ProductRepository {
  getById(productId: string): Promise<Product | null>;

  /** Offset/limit page over the full product set. */
  list(options?: Partial<PageOptions>): Promise<Page<Product>>;

  /** Every product. Prefer `list` where the caller can paginate. */
  listAll(): Promise<Product[]>;

  create(product: Product): Promise<Product>;

  /** Returns the updated product, or null when the product does not exist. */
  setWarranty(productId: string, warranty: WarrantyInfo): Promise<Product | null>;

  addWarrantyClaim(productId: string, claim: WarrantyClaim): Promise<Product | null>;

  setAssembly(productId: string, assembly: ProductAssembly): Promise<Product | null>;

  recall(productId: string, reason: string, recalledAt: number): Promise<Product | null>;
}

// === Events

export interface EventRepository {
  listByProduct(productId: string): Promise<TrackingEvent[]>;

  /** Every event across every product. Used by comparison and export services. */
  listAll(): Promise<TrackingEvent[]>;

  append(event: TrackingEvent): Promise<TrackingEvent>;
}

// === Auditors, attestations and batches

export interface AuditorListOptions {
  activeOnly?: boolean;
}

export interface AuditorRepository {
  list(options?: AuditorListOptions): Promise<Auditor[]>;

  getByAddress(address: string): Promise<Auditor | null>;

  create(auditor: Auditor): Promise<Auditor>;

  listAttestationsByProduct(productId: string): Promise<Attestation[]>;

  listAttestationsByTarget(productId: string, targetId: string): Promise<Attestation[]>;

  getBatch(batchId: string): Promise<BatchWithRecall | null>;

  listBatchesByProduct(productId: string): Promise<BatchWithRecall[]>;

  recallBatch(batchId: string, reason: string, recalledAt: number): Promise<BatchWithRecall | null>;
}
