/**
 * Contract-backed read model for product verification.
 *
 * Provides a normalized view of on-chain product + event data with an
 * optional in-process cache. Falls back to mock data when the contract
 * is unreachable (dev / testnet cold-start).
 *
 * Consistency guarantee: data is at most CACHE_TTL_MS stale.
 * Pass `bypassCache: true` to force a fresh contract read.
 *
 * closes #304
 */

import type { Product, TrackingEvent } from '@/lib/types';
import { getProductRepository, MockEventRepository, MockProductRepository } from '@/lib/data';

// Fixture repositories are referenced directly rather than through
// `getProductRepository()`: this module is already contract-first, so the
// factory would send the fallback path back to the contract it just failed on.
const fallbackProducts = new MockProductRepository();
const fallbackEvents = new MockEventRepository();

// ── Cache ─────────────────────────────────────────────────────────────────────
//
// Deliberately process-local Maps, NOT the KV repository (`@/lib/store`):
// these are read-through caches of on-chain data with a 60s TTL, so a cold
// cache simply triggers a fresh contract read. Persisting them across
// invocations would add cost and risk serving data staler than the TTL implies.
// See docs/persistence.md ("Caches vs. persistence").

const CACHE_TTL_MS = 60_000; // 60 s

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const productCache = new Map<string, CacheEntry<Product>>();
const eventsCache = new Map<string, CacheEntry<TrackingEvent[]>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, value: T): void {
  map.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

export function invalidateProductCache(productId: string): void {
  productCache.delete(productId);
  eventsCache.delete(productId);
}

export function invalidateAllCaches(): void {
  productCache.clear();
  eventsCache.clear();
}

// ── Normalization ─────────────────────────────────────────────────────────────

/** Normalize raw on-chain product data into the canonical Product shape. */
function normalizeProduct(raw: Record<string, unknown>, id: string): Product {
  return {
    id,
    name: String(raw.name ?? ''),
    origin: String(raw.origin ?? ''),
    owner: String(raw.owner ?? ''),
    timestamp: Number(raw.timestamp ?? 0),
    active: raw.active !== false,
    authorizedActors: Array.isArray(raw.authorized_actors)
      ? (raw.authorized_actors as string[])
      : [],
    ownershipHistory: [],
  };
}

/** Normalize raw on-chain event data into the canonical TrackingEvent shape. */
function normalizeEvent(raw: Record<string, unknown>): TrackingEvent {
  const commitmentRaw = raw.metadata_commitment ?? raw.metadataCommitment;
  const commitment = typeof commitmentRaw === 'string' ? commitmentRaw : '';
  return {
    productId: String(raw.product_id ?? raw.productId ?? ''),
    location: String(raw.location ?? ''),
    actor: String(raw.actor ?? ''),
    timestamp: Number(raw.timestamp ?? 0),
    eventType: String(raw.event_type ?? raw.eventType ?? 'HARVEST') as TrackingEvent['eventType'],
    metadata: typeof raw.metadata === 'string' ? raw.metadata : JSON.stringify(raw.metadata ?? {}),
    metadataCommitment: commitment || undefined,
    privateMetadata: Boolean(raw.private_metadata ?? raw.privateMetadata ?? false),
  };
}

// ── Contract reader ───────────────────────────────────────────────────────────

async function fetchProductFromContract(productId: string): Promise<Product | null> {
  try {
    // Dynamic import keeps the Stellar SDK out of the SSR bundle when unused.
    const { contractClient } = await import('@/lib/stellar/contract');
    // Use a read-only system address; no wallet needed for view calls.
    const raw = await contractClient.getProduct(productId, '');
    if (!raw) return null;
    return normalizeProduct(raw as Record<string, unknown>, productId);
  } catch {
    return null;
  }
}

async function fetchEventsFromContract(productId: string): Promise<TrackingEvent[] | null> {
  try {
    const { contractClient } = await import('@/lib/stellar/contract');
    const raw = await contractClient.getTrackingEvents(productId, '');
    if (!Array.isArray(raw)) return null;
    return raw.map((e) => normalizeEvent(e as Record<string, unknown>));
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface ReadModelOptions {
  /** Skip the cache and read directly from the contract. */
  bypassCache?: boolean;
}

/**
 * Fetch a single product from the contract-backed read model.
 * Falls back to mock data when the contract is unavailable.
 */
export async function getProduct(
  productId: string,
  opts: ReadModelOptions = {},
): Promise<Product | null> {
  if (!opts.bypassCache) {
    const cached = cacheGet(productCache, productId);
    if (cached) return cached;
  }

  const onChain = await fetchProductFromContract(productId);
  if (onChain) {
    cacheSet(productCache, productId, onChain);
    return onChain;
  }

  // Graceful fallback — fixture data for dev / degraded dependency
  return fallbackProducts.getById(productId);
}

/**
 * Fetch tracking events for a product from the contract-backed read model.
 * Falls back to mock data when the contract is unavailable.
 */
export async function getTrackingEvents(
  productId: string,
  opts: ReadModelOptions = {},
): Promise<TrackingEvent[]> {
  if (!opts.bypassCache) {
    const cached = cacheGet(eventsCache, productId);
    if (cached) return cached;
  }

  const onChain = await fetchEventsFromContract(productId);
  if (onChain) {
    cacheSet(eventsCache, productId, onChain);
    return onChain;
  }

  return fallbackEvents.listByProduct(productId);
}

/**
 * List all products through the configured repository.
 */
export async function listProducts(): Promise<Product[]> {
  return getProductRepository().listAll();
}
