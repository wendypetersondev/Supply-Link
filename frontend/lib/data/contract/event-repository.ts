import type { ContractClient } from '@/lib/stellar/contract-client.interface';
import type { TrackingEvent } from '@/lib/types';
import { RepositoryUnsupportedError } from '../errors';
import type { EventRepository } from '../types';
import { resolveLiveContractClient, type ContractClientResolver } from './client-resolver';

export class ContractEventRepository implements EventRepository {
  private client: ContractClient | null = null;

  constructor(private readonly resolveClient: ContractClientResolver = resolveLiveContractClient) {}

  private async getClient(): Promise<ContractClient> {
    this.client ??= await this.resolveClient();
    return this.client;
  }

  async listByProduct(productId: string): Promise<TrackingEvent[]> {
    const client = await this.getClient();
    return client.getTrackingEvents(productId, '');
  }

  async listAll(): Promise<TrackingEvent[]> {
    // Events are stored per product on chain; there is no global enumeration
    // entry point. Callers that need cross-product events must pass the
    // product IDs they care about and union the per-product reads.
    throw new RepositoryUnsupportedError('ContractEventRepository', 'listAll');
  }

  async append(event: TrackingEvent): Promise<TrackingEvent> {
    const client = await this.getClient();
    await client.addTrackingEvent(
      event.productId,
      event.location,
      event.eventType,
      event.metadata,
      event.actor,
    );
    return event;
  }
}
