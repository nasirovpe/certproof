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
  simulateCertificateRevocation,
  verifyCertificateRevokedReceipt,
  reconcileRevokedCertificate,
  fetchIssuerCertificates,
} from '@/lib/certificate/registry';

const TEST_ANVIL_PORT = 8548;
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

describe('Certificate Revocation Integration against Local Anvil (Real Node)', () => {
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

  const docHash1: Hex = '0x1111222233334444555566667777888899990000aaaabbbbccccddddeeeeffff';
  const docHash2: Hex = '0x222233334444555566667777888899990000aaaabbbbccccddddeeeeffff1111';
  let certId1: Hex;
  let certId2: Hex;

  it('allows original issuer to revoke their certificate with event and state reconciliation', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const issuer1Wallet = createWalletClient({
      account: issuer1Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    certId1 = generateCertificateId();

    // 1. Register certificate
    const regTx = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [certId1, docHash1],
    });
    await publicClient.waitForTransactionReceipt({ hash: regTx });

    // 2. Pre-read & Simulate revocation
    const simResult = await simulateCertificateRevocation(
      publicClient,
      deployedRegistryAddress,
      certId1,
      issuer1Account.address
    );
    expect(simResult.success).toBe(true);

    // 3. Execute revocation transaction
    const revokeTx = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'revokeCertificate',
      args: [certId1],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: revokeTx });
    expect(receipt.status).toBe('success');

    // 4. Verify receipt and CertificateRevoked event log
    const verifyResult = verifyCertificateRevokedReceipt(receipt, deployedRegistryAddress, {
      certId: certId1,
      issuer: issuer1Account.address,
    });
    expect(verifyResult.verified).toBe(true);
    expect(verifyResult.revokedAt).toBeGreaterThan(0);

    // 5. Reconcile updated on-chain certificate state
    const reconciled = await reconcileRevokedCertificate(
      publicClient,
      deployedRegistryAddress,
      certId1
    );
    expect(reconciled.revoked).toBe(true);
    expect(reconciled.revokedAt).toBe(verifyResult.revokedAt);
    expect(reconciled.certId).toBe(certId1);
    expect(reconciled.documentHash).toBe(docHash1);
    expect(reconciled.issuer.toLowerCase()).toBe(issuer1Account.address.toLowerCase());
    expect(reconciled.registeredAt).toBeGreaterThan(0);
  });

  it('allows original issuer to revoke after administrator deauthorization', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const adminWallet = createWalletClient({
      account: adminAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const issuer1Wallet = createWalletClient({
      account: issuer1Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    certId2 = generateCertificateId();

    // 1. Register certificate while still authorized
    const regTx = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [certId2, docHash2],
    });
    await publicClient.waitForTransactionReceipt({ hash: regTx });

    // 2. Administrator deauthorizes Issuer 1
    const deauthTx = await adminWallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'setIssuerAuthorization',
      args: [issuer1Account.address, false],
    });
    await publicClient.waitForTransactionReceipt({ hash: deauthTx });

    // Confirm Issuer 1 is deauthorized
    const isAuth = await publicClient.readContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'isIssuerAuthorized',
      args: [issuer1Account.address],
    });
    expect(isAuth).toBe(false);

    // 3. Confirm deauthorized issuer cannot register a new certificate
    const dummyCertId = generateCertificateId();
    await expect(
      issuer1Wallet.writeContract({
        address: deployedRegistryAddress,
        abi: CertProofRegistryABI,
        functionName: 'registerCertificate',
        args: [dummyCertId, '0x3333333333333333333333333333333333333333333333333333333333333333'],
      })
    ).rejects.toThrow();

    // 4. Confirm deauthorized issuer CAN simulate and revoke their prior certificate
    const simResult = await simulateCertificateRevocation(
      publicClient,
      deployedRegistryAddress,
      certId2,
      issuer1Account.address
    );
    expect(simResult.success).toBe(true);

    const revokeTx = await issuer1Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'revokeCertificate',
      args: [certId2],
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: revokeTx });
    expect(receipt.status).toBe('success');

    // 5. Verify state
    const reconciled = await reconcileRevokedCertificate(
      publicClient,
      deployedRegistryAddress,
      certId2
    );
    expect(reconciled.revoked).toBe(true);
    expect(reconciled.isIssuerCurrentlyAuthorized).toBe(false); // Independent fact!
  });

  it('rejects revocation from unauthorized strangers and administrator', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const strangerWallet = createWalletClient({
      account: strangerAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const adminWallet = createWalletClient({
      account: adminAccount,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Register a new active certificate by Issuer 2
    const issuer2Wallet = createWalletClient({
      account: issuer2Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const testCertId = generateCertificateId();
    const testDocHash: Hex = '0x4444444444444444444444444444444444444444444444444444444444444444';

    const regTx = await issuer2Wallet.writeContract({
      address: deployedRegistryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [testCertId, testDocHash],
    });
    await publicClient.waitForTransactionReceipt({ hash: regTx });

    // Stranger attempts simulation
    const strangerSim = await simulateCertificateRevocation(
      publicClient,
      deployedRegistryAddress,
      testCertId,
      strangerAccount.address
    );
    expect(strangerSim.success).toBe(false);
    expect(strangerSim.errorType).toBe('NOT_CERTIFICATE_ISSUER');

    // Stranger attempts transaction -> reverts
    await expect(
      strangerWallet.writeContract({
        address: deployedRegistryAddress,
        abi: CertProofRegistryABI,
        functionName: 'revokeCertificate',
        args: [testCertId],
      })
    ).rejects.toThrow();

    // Administrator attempts simulation
    const adminSim = await simulateCertificateRevocation(
      publicClient,
      deployedRegistryAddress,
      testCertId,
      adminAccount.address
    );
    expect(adminSim.success).toBe(false);
    expect(adminSim.errorType).toBe('NOT_CERTIFICATE_ISSUER');

    // Administrator attempts transaction -> reverts (Admin has NO revocation authority)
    await expect(
      adminWallet.writeContract({
        address: deployedRegistryAddress,
        abi: CertProofRegistryABI,
        functionName: 'revokeCertificate',
        args: [testCertId],
      })
    ).rejects.toThrow();
  });

  it('rejects revocation of unknown certificate and repeated revocation', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });
    const issuer1Wallet = createWalletClient({
      account: issuer1Account,
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // 1. Unknown non-existent certificate
    const nonexistentCertId = generateCertificateId();
    const unknownSim = await simulateCertificateRevocation(
      publicClient,
      deployedRegistryAddress,
      nonexistentCertId,
      issuer1Account.address
    );
    expect(unknownSim.success).toBe(false);
    expect(unknownSim.errorType).toBe('CERTIFICATE_NOT_FOUND');

    await expect(
      issuer1Wallet.writeContract({
        address: deployedRegistryAddress,
        abi: CertProofRegistryABI,
        functionName: 'revokeCertificate',
        args: [nonexistentCertId],
      })
    ).rejects.toThrow();

    // 2. Repeated revocation of already revoked certId1
    const repeatedSim = await simulateCertificateRevocation(
      publicClient,
      deployedRegistryAddress,
      certId1,
      issuer1Account.address
    );
    expect(repeatedSim.success).toBe(false);
    expect(repeatedSim.errorType).toBe('ALREADY_REVOKED');

    await expect(
      issuer1Wallet.writeContract({
        address: deployedRegistryAddress,
        abi: CertProofRegistryABI,
        functionName: 'revokeCertificate',
        args: [certId1],
      })
    ).rejects.toThrow();
  });

  it('preserves registration fields and displays authoritative revokedAt in paginated list', async () => {
    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(RPC_URL),
    });

    // Query pagination for Issuer 1
    const { items, total } = await fetchIssuerCertificates(
      publicClient,
      deployedRegistryAddress,
      issuer1Account.address,
      0n,
      10n
    );

    expect(total).toBe(2);
    expect(items.length).toBe(2);

    const revokedItem1 = items.find((i) => i.certId.toLowerCase() === certId1.toLowerCase());
    expect(revokedItem1).toBeDefined();
    expect(revokedItem1!.revoked).toBe(true);
    expect(revokedItem1!.revokedAt).toBeGreaterThan(0);
    expect(revokedItem1!.registeredAt).toBeGreaterThan(0);
    expect(revokedItem1!.documentHash).toBe(docHash1);

    const revokedItem2 = items.find((i) => i.certId.toLowerCase() === certId2.toLowerCase());
    expect(revokedItem2).toBeDefined();
    expect(revokedItem2!.revoked).toBe(true);
    expect(revokedItem2!.isIssuerCurrentlyAuthorized).toBe(false);
  });
});
