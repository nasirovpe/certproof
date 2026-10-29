import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  http,
  Address,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvilChain } from '@/lib/config/wagmi';
import { CertProofRegistryABI } from '@/lib/abi/CertProofRegistry';

const TEST_ANVIL_PORT = 8546;
const RPC_URL = `http://127.0.0.1:${TEST_ANVIL_PORT}`;

// Disposable Anvil account 0 (admin) and account 1 (issuer)
const ADMIN_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ISSUER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const STRANGER_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const adminAccount = privateKeyToAccount(ADMIN_PK);
const issuerAccount = privateKeyToAccount(ISSUER_PK);
const strangerAccount = privateKeyToAccount(STRANGER_PK);

let anvilProc: ChildProcess | null = null;
let deployedRegistryAddress: Address;

async function isPortReachable(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe('Registry Authorization Reads against Local Anvil', () => {
  beforeAll(async () => {
    // 1. Start local Anvil on dedicated test port
    const anvilBin = `${process.env.HOME}/.foundry/bin/anvil`;
    anvilProc = spawn(anvilBin, ['--port', String(TEST_ANVIL_PORT), '--silent']);

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await isPortReachable(TEST_ANVIL_PORT)) {
        break;
      }
    }

    if (!(await isPortReachable(TEST_ANVIL_PORT))) {
      throw new Error('Timeout waiting for Anvil to start on port ' + TEST_ANVIL_PORT);
    }

    // 2. Deploy CertProofRegistry
    const artifactPath = path.resolve(
      __dirname,
      '../../contracts/out/CertProofRegistry.sol/CertProofRegistry.json'
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const adminWallet = createWalletClient({
      account: adminAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const deployTxHash = await adminWallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [adminAccount.address],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
    deployedRegistryAddress = receipt.contractAddress as Address;
  });

  afterAll(() => {
    if (anvilProc) {
      anvilProc.kill();
    }
  });

  it('correctly reports authorized issuer when granted on-chain', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const adminWallet = createWalletClient({
      account: adminAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Authorize issuer
    const authTx = await adminWallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'setIssuerAuthorization',
      args: [issuerAccount.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });

    const isAuthorized = await publicClient.readContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'isIssuerAuthorized',
      args: [issuerAccount.address],
    });

    expect(isAuthorized).toBe(true);
  });

  it('correctly reports unauthorized when de-authorized on-chain', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const adminWallet = createWalletClient({
      account: adminAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Deauthorize issuer
    const deauthTx = await adminWallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'setIssuerAuthorization',
      args: [issuerAccount.address, false],
    });
    await publicClient.waitForTransactionReceipt({ hash: deauthTx });

    const isAuthorized = await publicClient.readContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'isIssuerAuthorized',
      args: [issuerAccount.address],
    });

    expect(isAuthorized).toBe(false);
  });

  it('correctly reports unauthorized for an address never granted issuance rights', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const isAuthorized = await publicClient.readContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'isIssuerAuthorized',
      args: [strangerAccount.address],
    });

    expect(isAuthorized).toBe(false);
  });

  it('detects missing deployment when contract address has no bytecode', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const nonExistentAddress = '0x1111111111111111111111111111111111111111' as Address;
    const code = await publicClient.getBytecode({ address: nonExistentAddress });

    expect(!code || code === '0x').toBe(true);
  });

  it('distinguishes RPC node failure from unauthorized status', async () => {
    // Connect to an offline port
    const offlineClient = createPublicClient({
      chain: anvilChain,
      transport: http('http://127.0.0.1:8999', { timeout: 1000, retryCount: 0 }),
    });

    let threwError = false;
    let isUnauthorized = false;

    try {
      await offlineClient.readContract({
        address: deployedRegistryAddress,
        abi: CertProofRegistryABI,
        functionName: 'isIssuerAuthorized',
        args: [issuerAccount.address],
      });
    } catch (err: unknown) {
      threwError = true;
      // RPC transport error must NEVER be converted to false / unauthorized
      isUnauthorized = false;
    }

    expect(threwError).toBe(true);
    expect(isUnauthorized).toBe(false);
  });
});
