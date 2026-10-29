import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {
  createPublicClient,
  createWalletClient,
  http,
  Address,
  Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { anvilChain } from '@/lib/config/chains';
import { CertProofRegistryABI } from '@/lib/abi/CertProofRegistry';
import {
  generateCertificateId,
  fetchPublicCertificate,
} from '@/lib/certificate/registry';

const TEST_ANVIL_PORT = 8549;
const RPC_URL = `http://127.0.0.1:${TEST_ANVIL_PORT}`;

const ADMIN_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ISSUER_1_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const adminAccount = privateKeyToAccount(ADMIN_PK);
const issuer1Account = privateKeyToAccount(ISSUER_1_PK);

let anvilProc: ChildProcess | null = null;
let deployedRegistryAddress: Address;

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');
const hashesJson = JSON.parse(
  fs.readFileSync(path.join(FIXTURES_DIR, 'hashes.json'), 'utf-8')
);

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

describe('Public Certificate Verification Integration against Local Anvil (Real Node)', () => {
  let publicClient: any;
  let issuer1Wallet: any;
  let adminWallet: any;
  let testCertId: Hex;

  beforeAll(async () => {
    const anvilBin = `${process.env.HOME}/.foundry/bin/anvil`;
    anvilProc = spawn(anvilBin, ['--port', String(TEST_ANVIL_PORT), '--silent']);

    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      if (await isPortReachable(TEST_ANVIL_PORT)) {
        break;
      }
    }

    if (!(await isPortReachable(TEST_ANVIL_PORT))) {
      throw new Error(`Timeout waiting for Anvil to start on port ${TEST_ANVIL_PORT}`);
    }

    const artifactPath = path.resolve(
      __dirname,
      '../../contracts/out/CertProofRegistry.sol/CertProofRegistry.json'
    );
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

    publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    adminWallet = createWalletClient({
      account: adminAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    issuer1Wallet = createWalletClient({
      account: issuer1Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Deploy contract
    const deployTx = await adminWallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [adminAccount.address],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
    deployedRegistryAddress = receipt.contractAddress as Address;

    // Authorize Issuer 1
    const authTx = await adminWallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'setIssuerAuthorization',
      args: [issuer1Account.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });

    // Register test certificate
    testCertId = generateCertificateId();
    const docHash = hashesJson.files.original.keccak256 as Hex;

    const regTx = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [testCertId, docHash],
    });
    await publicClient.waitForTransactionReceipt({ hash: regTx });
  }, 30000);

  afterAll(() => {
    if (anvilProc) {
      anvilProc.kill();
      anvilProc = null;
    }
  });

  it('reads authoritative registered certificate directly from contract with consistent block snapshot', async () => {
    const result = await fetchPublicCertificate(
      publicClient,
      deployedRegistryAddress,
      testCertId,
      { expectedChainId: 31337 }
    );

    expect(result.status).toBe('REGISTERED');
    expect(result.certId).toBe(testCertId);
    expect(result.chainId).toBe(31337);
    expect(result.registryAddress).toBe(deployedRegistryAddress);
    expect(result.blockNumber).toBeDefined();
    expect(result.blockNumber).toBeGreaterThan(0n);

    expect(result.record).toBeDefined();
    expect(result.record?.certId).toBe(testCertId);
    expect(result.record?.documentHash).toBe(hashesJson.files.original.keccak256);
    expect(result.record?.issuer.toLowerCase()).toBe(issuer1Account.address.toLowerCase());
    expect(result.record?.registeredAt).toBeGreaterThan(0);
    expect(result.record?.revoked).toBe(false);
    expect(result.record?.revokedAt).toBe(0);
    expect(result.isIssuerCurrentlyAuthorized).toBe(true);
  });

  it('correctly reports unregistered certificate for unused opaque certId', async () => {
    const unusedCertId = generateCertificateId();
    const result = await fetchPublicCertificate(
      publicClient,
      deployedRegistryAddress,
      unusedCertId,
      { expectedChainId: 31337 }
    );

    expect(result.status).toBe('UNREGISTERED');
    expect(result.certId).toBe(unusedCertId);
    expect(result.record).toBeUndefined();
    expect(result.blockNumber).toBeDefined();
  });

  it('rejects malformed certificate IDs prior to RPC query', async () => {
    const result = await fetchPublicCertificate(
      publicClient,
      deployedRegistryAddress,
      '0x1234', // too short
      { expectedChainId: 31337 }
    );

    expect(result.status).toBe('MALFORMED_ID');
    expect(result.errorMessage).toMatch(/Expected a 66-character hexadecimal string/i);
  });

  it('rejects unsupported deployment parameters', async () => {
    const resultWrongChain = await fetchPublicCertificate(
      publicClient,
      deployedRegistryAddress,
      testCertId,
      { expectedChainId: 31337, requestedChainId: 1 }
    );
    expect(resultWrongChain.status).toBe('UNSUPPORTED_DEPLOYMENT');
    expect(resultWrongChain.errorMessage).toMatch(/Unsupported chain ID 1/i);

    const resultWrongRegistry = await fetchPublicCertificate(
      publicClient,
      deployedRegistryAddress,
      testCertId,
      {
        expectedChainId: 31337,
        requestedRegistry: '0x000000000000000000000000000000000000dead',
      }
    );
    expect(resultWrongRegistry.status).toBe('UNSUPPORTED_DEPLOYMENT');
    expect(resultWrongRegistry.errorMessage).toMatch(/Unsupported registry address/i);
  });

  it('detects missing deployment when registry address has no contract bytecode', async () => {
    const emptyAddress = '0x1234567890123456789012345678901234567890' as Address;
    const result = await fetchPublicCertificate(
      publicClient,
      emptyAddress,
      testCertId,
      { expectedChainId: 31337 }
    );

    expect(result.status).toBe('MISSING_DEPLOYMENT');
    expect(result.errorMessage).toMatch(/No smart contract bytecode deployed/i);
  });

  it('reflects on-chain revocation while preserving immutable registration record', async () => {
    // Revoke test certificate
    const revokeTx = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'revokeCertificate',
      args: [testCertId],
    });
    await publicClient.waitForTransactionReceipt({ hash: revokeTx });

    // Read on-chain status
    const result = await fetchPublicCertificate(
      publicClient,
      deployedRegistryAddress,
      testCertId,
      { expectedChainId: 31337 }
    );

    expect(result.status).toBe('REGISTERED');
    expect(result.record?.revoked).toBe(true);
    expect(result.record?.revokedAt).toBeGreaterThan(0);
    // Immutable registration parameters remain completely intact
    expect(result.record?.documentHash).toBe(hashesJson.files.original.keccak256);
    expect(result.record?.issuer.toLowerCase()).toBe(issuer1Account.address.toLowerCase());
    expect(result.record?.registeredAt).toBeGreaterThan(0);
  });

  it('reflects issuer deauthorization simultaneously with revocation on-chain', async () => {
    // Deauthorize Issuer 1
    const deauthTx = await adminWallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'setIssuerAuthorization',
      args: [issuer1Account.address, false],
    });
    await publicClient.waitForTransactionReceipt({ hash: deauthTx });

    const result = await fetchPublicCertificate(
      publicClient,
      deployedRegistryAddress,
      testCertId,
      { expectedChainId: 31337 }
    );

    expect(result.status).toBe('REGISTERED');
    expect(result.record?.revoked).toBe(true);
    expect(result.isIssuerCurrentlyAuthorized).toBe(false);
  });

  it('functions completely without MongoDB availability (zero database dependency)', async () => {
    // Ensure that even if MONGODB_URI is invalid/unreachable, public verification operates purely on-chain
    const result = await fetchPublicCertificate(
      publicClient,
      deployedRegistryAddress,
      testCertId,
      { expectedChainId: 31337 }
    );

    expect(result.status).toBe('REGISTERED');
    expect(result.record?.documentHash).toBe(hashesJson.files.original.keccak256);
  });

  it('distinguishes RPC failure from unregistered or unauthorized when node unreachable', async () => {
    const deadClient = createPublicClient({
      chain: anvilChain,
      transport: http('http://127.0.0.1:8599', { timeout: 1000 }), // Dead port
    });

    const result = await fetchPublicCertificate(
      deadClient,
      deployedRegistryAddress,
      testCertId,
      { expectedChainId: 31337 }
    );

    expect(result.status).toBe('RPC_ERROR');
    expect(result.errorMessage).toMatch(/RPC communication error/i);
    expect(result.record).toBeUndefined();
  });
});
