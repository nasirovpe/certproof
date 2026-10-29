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
import { anvilChain } from '@/lib/config/wagmi';
import { CertProofRegistryABI } from '@/lib/abi/CertProofRegistry';
import {
  generateCertificateId,
  checkCertificateIdAvailable,
  simulateCertificateRegistration,
  verifyCertificateRegisteredReceipt,
  fetchIssuerCertificates,
} from '@/lib/certificate/registry';

const TEST_ANVIL_PORT = 8547;
const RPC_URL = `http://127.0.0.1:${TEST_ANVIL_PORT}`;

const ADMIN_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ISSUER_1_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ISSUER_2_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';
const STRANGER_PK = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6';

const adminAccount = privateKeyToAccount(ADMIN_PK);
const issuer1Account = privateKeyToAccount(ISSUER_1_PK);
const issuer2Account = privateKeyToAccount(ISSUER_2_PK);
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

describe('Certificate Registration & Bounded Pagination against Local Anvil', () => {
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

    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const adminWallet = createWalletClient({
      account: adminAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const deployTx = await adminWallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [adminAccount.address],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
    deployedRegistryAddress = receipt.contractAddress as Address;

    // Authorize Issuer 1 and Issuer 2
    const authTx1 = await adminWallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'setIssuerAuthorization',
      args: [issuer1Account.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx1 });

    const authTx2 = await adminWallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'setIssuerAuthorization',
      args: [issuer2Account.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx2 });
  });

  afterAll(() => {
    if (anvilProc) {
      anvilProc.kill();
    }
  });

  const sampleDocHash1: Hex = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const sampleDocHash2: Hex = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  it('generates non-zero opaque 32-byte certificate IDs', () => {
    const id1 = generateCertificateId();
    const id2 = generateCertificateId();
    expect(id1).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(id2).toMatch(/^0x[0-9a-fA-F]{64}$/);
    expect(id1).not.toBe('0x0000000000000000000000000000000000000000000000000000000000000000');
    expect(id1).not.toBe(id2);
  });

  it('allows authorized issuer to simulate and register a certificate', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const issuer1Wallet = createWalletClient({
      account: issuer1Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const certId = generateCertificateId();

    // 1. Check ID available
    const isAvailable = await checkCertificateIdAvailable(
      publicClient,
      deployedRegistryAddress,
      certId
    );
    expect(isAvailable).toBe(true);

    // 2. Pre-transaction simulation
    const simResult = await simulateCertificateRegistration(
      publicClient,
      deployedRegistryAddress,
      certId,
      sampleDocHash1,
      issuer1Account.address
    );
    expect(simResult.success).toBe(true);

    // 3. Broadcast transaction
    const txHash = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [certId, sampleDocHash1],
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    // 4. Verify receipt and matching event
    const verification = verifyCertificateRegisteredReceipt(
      receipt,
      deployedRegistryAddress,
      {
        certId,
        issuer: issuer1Account.address,
        documentHash: sampleDocHash1,
      }
    );

    expect(verification.verified).toBe(true);
    expect(verification.registeredAt).toBeGreaterThan(0);

    // ID is no longer available
    const isStillAvailable = await checkCertificateIdAvailable(
      publicClient,
      deployedRegistryAddress,
      certId
    );
    expect(isStillAvailable).toBe(false);
  });

  it('rejects registration from an unauthorized stranger', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const strangerWallet = createWalletClient({
      account: strangerAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    const certId = generateCertificateId();
    const docHash: Hex = '0x1234123412341234123412341234123412341234123412341234123412341234';

    // Simulation fails
    const simResult = await simulateCertificateRegistration(
      publicClient,
      deployedRegistryAddress,
      certId,
      docHash,
      strangerAccount.address
    );
    expect(simResult.success).toBe(false);
    expect(simResult.errorType).toBe('UNAUTHORIZED_ISSUER');

    // On-chain broadcast reverts
    await expect(
      strangerWallet.writeContract({
        address: deployedRegistryAddress,
        abi: CertProofRegistryABI,
        functionName: 'registerCertificate',
        args: [certId, docHash],
      })
    ).rejects.toThrow();
  });

  it('rejects duplicate registration of the same document hash by the same issuer', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const issuer1Wallet = createWalletClient({
      account: issuer1Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Issuer 1 already registered sampleDocHash1. Try to register it again with a new certId!
    const newCertId = generateCertificateId();

    const simResult = await simulateCertificateRegistration(
      publicClient,
      deployedRegistryAddress,
      newCertId,
      sampleDocHash1,
      issuer1Account.address
    );
    expect(simResult.success).toBe(false);
    expect(simResult.errorType).toBe('ALREADY_REGISTERED');
    expect(simResult.errorReason).toContain('permanently prohibited');

    // Broadcast reverts
    await expect(
      issuer1Wallet.writeContract({
        address: deployedRegistryAddress,
        abi: CertProofRegistryABI,
        functionName: 'registerCertificate',
        args: [newCertId, sampleDocHash1],
      })
    ).rejects.toThrow();
  });

  it('rejects duplicate certId globally even with different docHash', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const issuer2Wallet = createWalletClient({
      account: issuer2Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Register a cert for Issuer 2
    const certId = generateCertificateId();
    const docHashA: Hex = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
    const tx = await issuer2Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [certId, docHashA],
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });

    // Now try to reuse that same certId with a new docHashB
    const docHashB: Hex = '0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd';
    const simResult = await simulateCertificateRegistration(
      publicClient,
      deployedRegistryAddress,
      certId,
      docHashB,
      issuer2Account.address
    );
    expect(simResult.success).toBe(false);
    expect(simResult.errorType).toBe('CERT_ID_EXISTS');
  });

  it('allows a different authorized issuer to independently register the same document hash', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const issuer2Wallet = createWalletClient({
      account: issuer2Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Issuer 1 registered sampleDocHash1. Now Issuer 2 registers sampleDocHash1 with their own new certId
    const issuer2CertId = generateCertificateId();

    const simResult = await simulateCertificateRegistration(
      publicClient,
      deployedRegistryAddress,
      issuer2CertId,
      sampleDocHash1,
      issuer2Account.address
    );
    expect(simResult.success).toBe(true);

    const txHash = await issuer2Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [issuer2CertId, sampleDocHash1],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const verification = verifyCertificateRegisteredReceipt(
      receipt,
      deployedRegistryAddress,
      {
        certId: issuer2CertId,
        issuer: issuer2Account.address,
        documentHash: sampleDocHash1,
      }
    );
    expect(verification.verified).toBe(true);
  });

  it('permanently blocks duplicate document hash even after certificate revocation', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const issuer1Wallet = createWalletClient({
      account: issuer1Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Register a new cert for Issuer 1
    const certId = generateCertificateId();
    const docHashToRevoke: Hex = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee';
    const regTx = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [certId, docHashToRevoke],
    });
    await publicClient.waitForTransactionReceipt({ hash: regTx });

    // Revoke that certificate
    const revokeTx = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'revokeCertificate',
      args: [certId],
    });
    await publicClient.waitForTransactionReceipt({ hash: revokeTx });

    // Try to register docHashToRevoke again
    const newCertId = generateCertificateId();
    const simResult = await simulateCertificateRegistration(
      publicClient,
      deployedRegistryAddress,
      newCertId,
      docHashToRevoke,
      issuer1Account.address
    );
    expect(simResult.success).toBe(false);
    expect(simResult.errorType).toBe('ALREADY_REGISTERED');
  });

  it('fetches bounded, paginated slices including revoked certificates', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Query Issuer 1's certificates with limit = 1
    const page1 = await fetchIssuerCertificates(
      publicClient,
      deployedRegistryAddress,
      issuer1Account.address,
      0n,
      1n
    );

    expect(page1.items.length).toBe(1);
    expect(page1.total).toBeGreaterThanOrEqual(2);
    expect(page1.nextOffset).toBe(1);
    expect(page1.items[0].isIssuerCurrentlyAuthorized).toBe(true);

    // Query Issuer 1's all certificates up to 10
    const all = await fetchIssuerCertificates(
      publicClient,
      deployedRegistryAddress,
      issuer1Account.address,
      0n,
      10n
    );
    expect(all.items.length).toBe(all.total);

    // One of them was revoked! Check that revoked certificates remain in history
    const revokedItem = all.items.find((c) => c.revoked);
    expect(revokedItem).toBeDefined();
    expect(revokedItem?.revoked).toBe(true);
    expect(revokedItem?.revokedAt).toBeGreaterThan(0);
    expect(revokedItem?.isIssuerCurrentlyAuthorized).toBe(true);

    // Query empty issuer (stranger)
    const emptyList = await fetchIssuerCertificates(
      publicClient,
      deployedRegistryAddress,
      strangerAccount.address,
      0n,
      10n
    );
    expect(emptyList.items.length).toBe(0);
    expect(emptyList.total).toBe(0);
  });
});
