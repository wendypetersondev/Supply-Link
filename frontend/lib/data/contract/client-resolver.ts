import type { ContractClient } from '@/lib/stellar/contract-client.interface';

export type ContractClientResolver = () => Promise<ContractClient>;

/**
 * Resolves the live client explicitly rather than the `contractClient` proxy:
 * the proxy applies its own NEXT_PUBLIC_USE_MOCK_CONTRACT switch, which would
 * make the data-source flag ambiguous. Mock data is selected by the repository
 * factory, never underneath a contract repository.
 *
 * The dynamic import keeps the Stellar SDK out of bundles that never read
 * through the contract repositories.
 */
export const resolveLiveContractClient: ContractClientResolver = async () => {
  const { createContractClient } = await import('@/lib/stellar/contract');
  return createContractClient({ useMock: false });
};
