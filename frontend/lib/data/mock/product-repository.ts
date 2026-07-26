import type { Product, ProductAssembly, WarrantyClaim, WarrantyInfo } from '@/lib/types';
import type { Page, PageOptions, ProductRepository } from '../types';
import { mockStore, replaceProduct, type MockStore } from './store';

export class MockProductRepository implements ProductRepository {
  constructor(private readonly store: MockStore = mockStore) {}

  async getById(productId: string): Promise<Product | null> {
    return this.store.products.find((p) => p.id === productId) ?? null;
  }

  async list(options: Partial<PageOptions> = {}): Promise<Page<Product>> {
    const offset = options.offset ?? 0;
    const limit = options.limit ?? this.store.products.length;
    return {
      items: this.store.products.slice(offset, offset + limit),
      total: this.store.products.length,
    };
  }

  async listAll(): Promise<Product[]> {
    return this.store.products;
  }

  async create(product: Product): Promise<Product> {
    this.store.products.push(product);
    return product;
  }

  async setWarranty(productId: string, warranty: WarrantyInfo): Promise<Product | null> {
    return replaceProduct(this.store, productId, (current) => ({ ...current, warranty }));
  }

  async addWarrantyClaim(productId: string, claim: WarrantyClaim): Promise<Product | null> {
    return replaceProduct(this.store, productId, (current) => ({
      ...current,
      warrantyClaims: [...(current.warrantyClaims ?? []), claim],
    }));
  }

  async setAssembly(productId: string, assembly: ProductAssembly): Promise<Product | null> {
    return replaceProduct(this.store, productId, (current) => ({ ...current, assembly }));
  }

  async recall(productId: string, reason: string, recalledAt: number): Promise<Product | null> {
    return replaceProduct(this.store, productId, (current) => ({
      ...current,
      recalled: true,
      recallReason: reason,
      recallTimestamp: recalledAt,
    }));
  }
}
