import { describe, it, expect } from 'vitest';
import { config, anvilChain } from '@/lib/config/wagmi';
import { sepolia } from 'wagmi/chains';

describe('Wagmi Injected Connector Architecture & Dependency Minimization', () => {
  it('configures strictly the injected connector without third-party wallet SDKs', () => {
    expect(config.connectors).toBeDefined();
    expect(config.connectors.length).toBe(1);

    const [connector] = config.connectors;
    expect(connector.id).toBe('metaMask');
    expect(connector.type).toBe('injected');
    expect(connector.name).toBeDefined();
  });

  it('verifies that no WalletConnect, Coinbase SDK, or MetaMask mobile SDK connectors are registered', () => {
    const connectorIds = config.connectors.map((c) => c.id.toLowerCase());
    const connectorTypes = config.connectors.map((c) => c.type.toLowerCase());

    expect(connectorIds).not.toContain('walletconnect');
    expect(connectorIds).not.toContain('coinbasewallet');
    expect(connectorIds).not.toContain('coinbasesdk');
    expect(connectorIds).not.toContain('metamasksdk');

    expect(connectorTypes).not.toContain('walletconnect');
    expect(connectorTypes).not.toContain('coinbasewallet');
  });

  it('supports Anvil local development and Sepolia testnet chains with HTTP transports', () => {
    const chainIds = config.chains.map((chain) => chain.id);
    expect(chainIds).toContain(anvilChain.id); // 31337
    expect(chainIds).toContain(sepolia.id); // 11155111
    expect(chainIds.length).toBe(2);
  });

  it('guarantees SSR configuration is enabled for Next.js App Router hydration', () => {
    // In Wagmi createConfig, ssr: true configures client storage and hydration safety
    expect(config._internal.ssr).toBe(true);
  });
});
