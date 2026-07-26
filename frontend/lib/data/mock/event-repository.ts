import type { TrackingEvent } from '@/lib/types';
import type { EventRepository } from '../types';
import { mockStore, type MockStore } from './store';

export class MockEventRepository implements EventRepository {
  constructor(private readonly store: MockStore = mockStore) {}

  async listByProduct(productId: string): Promise<TrackingEvent[]> {
    return this.store.events.filter((e) => e.productId === productId);
  }

  async listAll(): Promise<TrackingEvent[]> {
    return this.store.events;
  }

  async append(event: TrackingEvent): Promise<TrackingEvent> {
    this.store.events.push(event);
    return event;
  }
}
