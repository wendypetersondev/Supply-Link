import type { ContractClient } from '@/lib/stellar/contract-client.interface';
import type { Product, ProductAssembly, WarrantyClaim, WarrantyInfo } from '@/lib/types';
import { RepositoryUnsupportedError } from '../errors';
import type { Page, PageOptions, ProductRepository } from '../types';
import { resolveLiveContractClient, type ContractClientResolver } from './client-resolver';

/** Page size used when walking the contract's paginated product list. */
const LIST_PAGE_SIZE = 50;

/** Value of a settled read, or undefined when it rejected or returned null. */
function settled<T>(result: PromiseSettledResult<T | null>): T | undefined {
  return result.status === 'fulfilled' ? (result.value ?? undefined) : undefined;
}

export class ContractProductRepository implements ProductRepository {
  private client: ContractClient | null = null;

  constructor(private readonly resolveClient: ContractClientResolver = resolveLiveContractClient) {}

  private async getClient(): Promise<ContractClient> {
    this.client ??= await this.resolveClient();
    return this.client;
  }

  async getById(productId: string): Promise<Product | null> {
    const client = await this.getClient();
    const product = await client.getProduct(productId, '');
    if (!product) return null;
    return this.hydrate(client, product);
  }

  /**
   * Warranty, claims and assembly live in separate contract storage, so a
   * product read has to compose them. Each is optional, and an empty or failed
   * read leaves whatever the product record already carried untouched.
   */
  private async hydrate(client: ContractClient, product: Product): Promise<Product> {
    const [warranty, claims, assembly] = await Promise.allSettled([
      client.getWarranty(product.id),
      client.listWarrantyClaims(product.id),
      client.getAssembly(product.id),
    ]);

    return {
      ...product,
      warranty: settled(warranty) ?? product.warranty,
      warrantyClaims: settled(claims)?.length ? settled(claims) : product.warrantyClaims,
      assembly: settled(assembly) ?? product.assembly,
    };
  }

  async list(options: Partial<PageOptions> = {}): Promise<Page<Product>> {
    const client = await this.getClient();
    const offset = options.offset ?? 0;
    const limit = options.limit ?? LIST_PAGE_SIZE;

    // The contract pages by page index, so an unaligned offset needs a
    // covering read from page 0 that is then sliced locally.
    if (offset % limit === 0) {
      const { products, total } = await client.listProducts(offset / limit, limit, '');
      return { items: products, total };
    }

    const { products, total } = await client.listProducts(0, offset + limit, '');
    return { items: products.slice(offset, offset + limit), total };
  }

  async listAll(): Promise<Product[]> {
    const client = await this.getClient();
    const items: Product[] = [];
    let page = 0;

    for (;;) {
      const { products, total } = await client.listProducts(page, LIST_PAGE_SIZE, '');
      items.push(...products);
      if (products.length === 0 || items.length >= total) break;
      page++;
    }

    return items;
  }

  async create(product: Product): Promise<Product> {
    const client = await this.getClient();
    await client.registerProduct(
      product.id,
      product.name,
      product.origin,
      product.owner,
      product.owner,
    );
    return product;
  }

  async setWarranty(productId: string, warranty: WarrantyInfo): Promise<Product | null> {
    const client = await this.getClient();
    await client.registerWarranty(
      productId,
      warranty.durationSeconds,
      warranty.terms,
      warranty.termsRef,
      warranty.issuer,
    );
    return this.getById(productId);
  }

  async addWarrantyClaim(productId: string, claim: WarrantyClaim): Promise<Product | null> {
    const client = await this.getClient();
    await client.fileWarrantyClaim(
      productId,
      claim.claimId,
      claim.description,
      claim.proofRef,
      claim.claimant,
    );
    return this.getById(productId);
  }

  async setAssembly(productId: string, assembly: ProductAssembly): Promise<Product | null> {
    const client = await this.getClient();
    await client.registerAssembly(
      productId,
      assembly.componentIds,
      assembly.description,
      assembly.registeredBy,
    );
    return this.getById(productId);
  }

  async recall(): Promise<Product | null> {
    // The deployed contract exposes deactivate_product but no recall entry
    // point, and silently deactivating would lose the recall reason.
    throw new RepositoryUnsupportedError('ContractProductRepository', 'recall');
  }
}
