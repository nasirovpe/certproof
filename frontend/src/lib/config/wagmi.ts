import { http, createConfig, injected } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { anvilChain } from './chains';
import { getClientEnv } from './env';

export { anvilChain };

const clientEnv = getClientEnv();

export const config = createConfig({
  chains: [anvilChain, sepolia],
  connectors: [
    injected({
      target: 'metaMask',
      shimDisconnect: true,
    }),
  ],
  transports: {
    [anvilChain.id]: http(clientEnv.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545'),
    [sepolia.id]: http(clientEnv.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org'),
  },
  ssr: true,
});

declare module 'wagmi' {
  interface Register {
    config: typeof config;
  }
}
