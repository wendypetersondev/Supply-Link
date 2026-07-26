import type { Attestation, Auditor, BatchWithRecall } from '@/lib/types';
import type { AuditorListOptions, AuditorRepository } from '../types';
import { mockStore, type MockStore } from './store';

export class MockAuditorRepository implements AuditorRepository {
  constructor(private readonly store: MockStore = mockStore) {}

  async list(options: AuditorListOptions = {}): Promise<Auditor[]> {
    return options.activeOnly ? this.store.auditors.filter((a) => a.active) : this.store.auditors;
  }

  async getByAddress(address: string): Promise<Auditor | null> {
    return this.store.auditors.find((a) => a.address === address) ?? null;
  }

  async create(auditor: Auditor): Promise<Auditor> {
    this.store.auditors.push(auditor);
    return auditor;
  }

  async listAttestationsByProduct(productId: string): Promise<Attestation[]> {
    return this.store.attestations.filter((a) => a.productId === productId);
  }

  async listAttestationsByTarget(productId: string, targetId: string): Promise<Attestation[]> {
    return this.store.attestations.filter(
      (a) => a.productId === productId && a.targetId === targetId,
    );
  }

  async getBatch(batchId: string): Promise<BatchWithRecall | null> {
    return this.store.batches.find((b) => b.id === batchId) ?? null;
  }

  async listBatchesByProduct(productId: string): Promise<BatchWithRecall[]> {
    return this.store.batches.filter((b) => b.productIds.includes(productId));
  }

  async recallBatch(
    batchId: string,
    reason: string,
    recalledAt: number,
  ): Promise<BatchWithRecall | null> {
    const batch = this.store.batches.find((b) => b.id === batchId);
    if (!batch) return null;
    batch.recalled = true;
    batch.recallReason = reason;
    batch.recallTimestamp = recalledAt;
    return batch;
  }
}
