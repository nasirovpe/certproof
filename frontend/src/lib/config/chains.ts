import { defineChain } from 'viem';
import { getClientEnv } from './env';

const clientEnv = getClientEnv();

export const anvilChain = defineChain({
  id: 31337,
  name: 'Anvil Localhost',
  nativeCurrency: {
    name: 'Anvil Ether',
    symbol: 'ETH',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [clientEnv.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545'],
    },
  },
  testnet: true,
});
