#!/usr/bin/env node

/**
 * Isolated Anvil Persistence Verification Script
 *
 * Verifies that Anvil persistent volume preserves:
 * 1. Chain ID
 * 2. Deployed contract address and runtime bytecode
 * 3. Registered synthetic certificate state
 * across a normal container stop and restart.
 *
 * Also verifies that restarting the container does not silently redeploy
 * or mutate deployment manifests.
 */

import { execSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
  toHex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const TEST_PORT = 8595;
const TEST_RPC_URL = `http://127.0.0.1:${TEST_PORT}`;
const TEST_CONTAINER = 'certproof-anvil-persist-test';
const TEST_VOLUME = 'certproof-anvil-persist-test-vol';

// Dedicated Anvil test accounts
const ADMIN_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ISSUER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const adminAccount = privateKeyToAccount(ADMIN_PK);
const issuerAccount = privateKeyToAccount(ISSUER_PK);

// Load contract artifact
const artifactPath = path.join(
  ROOT_DIR,
  'contracts',
  'out',
  'CertProofRegistry.sol',
  'CertProofRegistry.json'
);

if (!fs.existsSync(artifactPath)) {
  console.error(`[ERROR] Contract artifact not found at ${artifactPath}. Run npm run compile first.`);
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const abi = artifact.abi;
const bytecode = artifact.bytecode.object;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRpc(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(TEST_RPC_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      });
      if (res.ok) return true;
    } catch {}
    await sleep(300);
  }
  throw new Error(`Timeout waiting for Anvil RPC at ${TEST_RPC_URL}`);
}

function cleanup() {
  console.log('[Teardown] Cleaning up isolated persistence test container and volume...');
  try {
    execSync(`docker rm -f ${TEST_CONTAINER}`, { stdio: 'ignore' });
  } catch {}
  try {
    execSync(`docker volume rm -f ${TEST_VOLUME}`, { stdio: 'ignore' });
  } catch {}
}

async function main() {
  console.log('===============================================================');
  console.log(' CertProof — Isolated Anvil Persistence Verification');
  console.log('===============================================================');

  // Snapshot existing manifests to ensure no mutation
  const originalManifestPath = path.join(ROOT_DIR, 'deployments', 'local-anvil.json');
  const originalManifestContent = fs.existsSync(originalManifestPath)
    ? fs.readFileSync(originalManifestPath, 'utf8')
    : null;

  try {
    cleanup();

    console.log('\n[Step 1] Creating isolated persistent Docker volume...');
    execSync(`docker volume create ${TEST_VOLUME}`, { stdio: 'inherit' });

    console.log('[Step 2] Launching isolated Anvil container...');
    const runCmd = [
      'run', '-d',
      '--name', TEST_CONTAINER,
      '--entrypoint', 'anvil',
      '--stop-signal', 'SIGINT',
      '-u', '0:0',
      '-v', `${TEST_VOLUME}:/anvil_data`,
      '-p', `${TEST_PORT}:8545`,
      'ghcr.io/foundry-rs/foundry:latest',
      '--host', '0.0.0.0',
      '--port', '8545',
      '--state', '/anvil_data/state.json',
      '--state-interval', '2',
    ];
    const runRes = spawnSync('docker', runCmd, { stdio: 'inherit' });
    if (runRes.status !== 0) {
      throw new Error('Failed to start Anvil test container');
    }

    await waitForRpc();
    console.log('  ✓ Anvil container started and accepting RPC calls.');

    const publicClient = createPublicClient({
      transport: http(TEST_RPC_URL),
    });

    const chainIdBefore = await publicClient.getChainId();
    console.log(`\n[Step 3] Initial Chain ID: ${chainIdBefore}`);

    // Deploy contract
    console.log('[Step 4] Deploying CertProofRegistry contract...');
    const adminWallet = createWalletClient({
      account: adminAccount,
      transport: http(TEST_RPC_URL),
    });

    const deployTxHash = await adminWallet.deployContract({
      abi,
      bytecode,
      args: [adminAccount.address],
    });

    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
    const contractAddress = deployReceipt.contractAddress;
    if (!contractAddress) {
      throw new Error('Contract deployment failed: no contract address in receipt');
    }

    const runtimeBytecodeBefore = await publicClient.getBytecode({ address: contractAddress });
    const runtimeCodeHashBefore = keccak256(runtimeBytecodeBefore);

    console.log(`  ✓ Deployed Contract Address: ${contractAddress}`);
    console.log(`  ✓ Runtime Bytecode Hash:    ${runtimeCodeHashBefore}`);

    // Authorize issuer
    console.log('\n[Step 5] Authorizing issuer and registering synthetic certificate...');
    const authTx = await adminWallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'setIssuerAuthorization',
      args: [issuerAccount.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });

    // Register synthetic certificate
    const issuerWallet = createWalletClient({
      account: issuerAccount,
      transport: http(TEST_RPC_URL),
    });

    const syntheticCertId = keccak256(encodePacked(['string', 'address'], ['PERSISTENCE_TEST_CERT_001', issuerAccount.address]));
    const syntheticDocHash = keccak256(toHex('Synthetic Certificate Data for Persistence Verification 2026'));

    const regTx = await issuerWallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'registerCertificate',
      args: [syntheticCertId, syntheticDocHash],
    });
    await publicClient.waitForTransactionReceipt({ hash: regTx });

    const certBefore = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'getCertificate',
      args: [syntheticCertId],
    });

    console.log(`  ✓ Synthetic Certificate Registered:`);
    console.log(`    - certId:       ${certBefore.certId}`);
    console.log(`    - issuer:       ${certBefore.issuer}`);
    console.log(`    - documentHash: ${certBefore.documentHash}`);
    console.log(`    - registeredAt: ${certBefore.registeredAt}`);
    console.log(`    - revoked:      ${certBefore.revoked}`);

    if (certBefore.certId.toLowerCase() !== syntheticCertId.toLowerCase()) {
      throw new Error('Recorded certId does not match synthetic input');
    }

    // Wait for state-interval / flush
    await sleep(2500);

    // Stop container normally
    console.log('\n[Step 6] Stopping Anvil container (normal container stop)...');
    execSync(`docker stop ${TEST_CONTAINER}`, { stdio: 'inherit' });
    console.log('  ✓ Container stopped.');

    // Remove stopped container (keeping persistent volume)
    execSync(`docker rm ${TEST_CONTAINER}`, { stdio: 'inherit' });

    // Restart using the same volume
    console.log('\n[Step 7] Restarting Anvil container using the SAME persistent volume...');
    const restartRes = spawnSync('docker', runCmd, { stdio: 'inherit' });
    if (restartRes.status !== 0) {
      throw new Error('Failed to restart Anvil container with persistent volume');
    }

    await waitForRpc();
    console.log('  ✓ Anvil container restarted and accepting RPC calls.');

    // Step 8: Verify persistence on restarted node
    console.log('\n[Step 8] Verifying state preservation on restarted node...');
    const chainIdAfter = await publicClient.getChainId();
    if (chainIdAfter !== chainIdBefore) {
      throw new Error(`Chain ID mismatch after restart! Expected ${chainIdBefore}, got ${chainIdAfter}`);
    }
    console.log(`  ✓ Chain ID preserved: ${chainIdAfter}`);

    const runtimeBytecodeAfter = await publicClient.getBytecode({ address: contractAddress });
    if (!runtimeBytecodeAfter || runtimeBytecodeAfter === '0x') {
      throw new Error(`Contract code missing at ${contractAddress} after restart!`);
    }
    const runtimeCodeHashAfter = keccak256(runtimeBytecodeAfter);
    if (runtimeCodeHashAfter.toLowerCase() !== runtimeCodeHashBefore.toLowerCase()) {
      throw new Error(`Runtime bytecode hash mismatch after restart! Expected ${runtimeCodeHashBefore}, got ${runtimeCodeHashAfter}`);
    }
    console.log(`  ✓ Contract code preserved: ${runtimeCodeHashAfter}`);

    const certAfter = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'getCertificate',
      args: [syntheticCertId],
    });

    if (certAfter.certId.toLowerCase() !== certBefore.certId.toLowerCase()) {
      throw new Error(`Certificate ID mismatch! Before: ${certBefore.certId}, After: ${certAfter.certId}`);
    }
    if (certAfter.issuer.toLowerCase() !== certBefore.issuer.toLowerCase()) {
      throw new Error(`Certificate issuer mismatch! Before: ${certBefore.issuer}, After: ${certAfter.issuer}`);
    }
    if (certAfter.documentHash.toLowerCase() !== certBefore.documentHash.toLowerCase()) {
      throw new Error(`Certificate documentHash mismatch! Before: ${certBefore.documentHash}, After: ${certAfter.documentHash}`);
    }
    if (certAfter.registeredAt !== certBefore.registeredAt) {
      throw new Error(`Certificate registeredAt mismatch! Before: ${certBefore.registeredAt}, After: ${certAfter.registeredAt}`);
    }
    if (certAfter.revoked !== false) {
      throw new Error(`Certificate revocation status incorrect! Expected false, got ${certAfter.revoked}`);
    }
    console.log(`  ✓ Synthetic Certificate state verified intact across restart:`);
    console.log(`    - certId:       ${certAfter.certId}`);
    console.log(`    - issuer:       ${certAfter.issuer}`);
    console.log(`    - documentHash: ${certAfter.documentHash}`);
    console.log(`    - registeredAt: ${certAfter.registeredAt}`);
    console.log(`    - revoked:      ${certAfter.revoked}`);

    // Step 9: Confirm manifests were not mutated
    console.log('\n[Step 9] Confirming repository manifests were not overwritten or mutated...');
    if (originalManifestContent !== null) {
      const currentContent = fs.readFileSync(originalManifestPath, 'utf8');
      if (currentContent !== originalManifestContent) {
        throw new Error('deployments/local-anvil.json was unexpectedly mutated!');
      }
      console.log('  ✓ deployments/local-anvil.json remains byte-for-byte identical.');
    }

    console.log('\n===============================================================');
    console.log(' ✔ ANVIL PERSISTENCE VERIFICATION PASSED PERFECTLY');
    console.log('===============================================================');
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('\n[FATAL ERROR]', err.message);
  process.exit(1);
});
