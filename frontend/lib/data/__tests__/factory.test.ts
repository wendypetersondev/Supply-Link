/**
 * The factory is the single switch between data sources: flipping DATA_SOURCE
 * has to change what every call site resolves, with no call site edits.
 */

import { describe, it, expect, afterEach } from 'vitest';
import {
  ContractEventRepository,
  ContractProductRepository,
  getDataSource,
  getEventRepository,
  getProductRepository,
  MockEventRepository,
  MockProductRepository,
} from '..';

const originalDataSource = process.env.DATA_SOURCE;

afterEach(() => {
  if (originalDataSource === undefined) {
    delete process.env.DATA_SOURCE;
  } else {
    process.env.DATA_SOURCE = originalDataSource;
  }
});

describe('repository factory', () => {
  it('defaults to the mock source', () => {
    delete process.env.DATA_SOURCE;
    expect(getDataSource()).toBe('mock');
    expect(getProductRepository()).toBeInstanceOf(MockProductRepository);
    expect(getEventRepository()).toBeInstanceOf(MockEventRepository);
  });

  it('treats an unrecognised value as mock', () => {
    process.env.DATA_SOURCE = 'postgres';
    expect(getDataSource()).toBe('mock');
    expect(getProductRepository()).toBeInstanceOf(MockProductRepository);
  });

  it('routes products and events to the contract when the flag is set', () => {
    process.env.DATA_SOURCE = 'contract';
    expect(getDataSource()).toBe('contract');
    expect(getProductRepository()).toBeInstanceOf(ContractProductRepository);
    expect(getEventRepository()).toBeInstanceOf(ContractEventRepository);
  });

  it('re-resolves when the flag changes between calls', () => {
    process.env.DATA_SOURCE = 'mock';
    expect(getProductRepository()).toBeInstanceOf(MockProductRepository);

    process.env.DATA_SOURCE = 'contract';
    expect(getProductRepository()).toBeInstanceOf(ContractProductRepository);

    process.env.DATA_SOURCE = 'mock';
    expect(getProductRepository()).toBeInstanceOf(MockProductRepository);
  });

  it('returns a stable instance while the flag is unchanged', () => {
    process.env.DATA_SOURCE = 'mock';
    expect(getProductRepository()).toBe(getProductRepository());
  });
});
