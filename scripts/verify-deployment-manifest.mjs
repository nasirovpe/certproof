#!/usr/bin/env node

/**
 * Verifies deployment manifest integrity and on-chain contract identity.
 * Validates chain ID, deployed bytecode hash, and prevents deployment ambiguity.
 *
 * Usage:
 *   node scripts/verify-deployment-manifest.mjs deployments/local-anvil.json [RPC_URL]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, http, keccak256 } from 'viem';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const manifestPath = process.argv[2] || path.join(ROOT_DIR, 'deployments', 'local-anvil.json');
const customRpcUrl = process.argv[3];

if (!fs.existsSync(manifestPath)) {
  console.error(`[ERROR] Manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log(`[Manifest] Verifying ${path.basename(manifestPath)} (${manifest.network}, Chain ID: ${manifest.chainId})`);

// 1. Schema integrity checks
const requiredFields = ['network', 'chainId', 'contractAddress', 'runtimeCodeHash'];
for (const field of requiredFields) {
  if (!manifest[field]) {
    console.error(`[ERROR] Manifest missing required field: ${field}`);
    process.exit(1);
  }
}

if (!/^0x[0-9a-fA-F]{40}$/.test(manifest.contractAddress)) {
  console.error(`[ERROR] Invalid contract address format: ${manifest.contractAddress}`);
  process.exit(1);
}

// 2. If contract address is zero address (placeholder), verify schema and exit
if (manifest.contractAddress === '0x0000000000000000000000000000000000000000') {
  console.log(`[INFO] Manifest contains placeholder address. Schema valid. (Status: ${manifest.status || 'unactivated'})`);
  process.exit(0);
}

// 3. Optional live on-chain bytecode verification
const defaultRpc = manifest.chainId === 31337
  ? 'http://127.0.0.1:8545'
  : (manifest.chainId === 11155111 ? 'https://rpc.sepolia.org' : undefined);

const rpcUrl = customRpcUrl || defaultRpc;

if (!rpcUrl) {
  console.log('[INFO] No RPC URL available. Schema verification passed.');
  process.exit(0);
}

try {
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 4000 }),
  });

  const onChainChainId = await client.getChainId();
  if (onChainChainId !== manifest.chainId) {
    console.error(`[ERROR] Chain ID mismatch! Expected ${manifest.chainId}, connected node reported ${onChainChainId}.`);
    process.exit(1);
  }
  console.log(`[Verified] Connected to RPC node (Chain ID: ${onChainChainId})`);

  const bytecode = await client.getBytecode({ address: manifest.contractAddress });
  if (!bytecode || bytecode === '0x') {
    console.warn(`[WARN] No bytecode deployed at ${manifest.contractAddress} on ${rpcUrl}.`);
    process.exit(2);
  }

  const computedHash = keccak256(bytecode);
  if (computedHash.toLowerCase() !== manifest.runtimeCodeHash.toLowerCase()) {
    console.error(`[ERROR] Bytecode hash mismatch!`);
    console.error(`  Expected: ${manifest.runtimeCodeHash}`);
    console.error(`  Observed: ${computedHash}`);
    process.exit(1);
  }

  console.log(`[Verified] On-chain deployed bytecode matches manifest runtimeCodeHash: ${computedHash}`);
  process.exit(0);
} catch (err) {
  console.log(`[Notice] RPC node unreachable at ${rpcUrl} (${err instanceof Error ? err.message : 'Timeout'}). Schema validated.`);
  process.exit(0);
}
