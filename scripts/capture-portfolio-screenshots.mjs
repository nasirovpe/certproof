#!/usr/bin/env node

/**
 * Capture Authentic Portfolio Screenshots
 *
 * Runs an isolated local stack (Anvil, MongoDB container, and Next.js production server),
 * seeds synthetic certificates and SIWE session, and uses Playwright Chrome to capture:
 * 1. Public verifier before file selection (docs/screenshots/01-public-verifier-initial.png)
 * 2. Matching PDF verification result (docs/screenshots/02-public-verifier-matching.png)
 * 3. Revoked certificate status facts (docs/screenshots/03-public-verifier-revoked.png)
 * 4. Issuer certificate list dashboard (docs/screenshots/04-issuer-certificate-list.png)
 */

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(ROOT_DIR, 'frontend');
const FIXTURES_DIR = path.resolve(ROOT_DIR, 'fixtures');
const SCREENSHOT_DIR = path.resolve(ROOT_DIR, 'docs', 'screenshots');

const mongoModule = await import(
  path.resolve(FRONTEND_DIR, 'node_modules', 'mongodb', 'lib', 'index.js')
);
const { MongoClient } = mongoModule;

const playwrightModule = await import(
  path.resolve(FRONTEND_DIR, 'node_modules/playwright/index.mjs')
);
const { chromium } = playwrightModule;

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const SCREENSHOT_ANVIL_PORT = 8545;
const SCREENSHOT_MONGO_PORT = 27018;
const SCREENSHOT_APP_PORT = 3010;

const ANVIL_RPC_URL = `http://127.0.0.1:${SCREENSHOT_ANVIL_PORT}`;
const APP_URL = `http://localhost:${SCREENSHOT_APP_PORT}`;
const MONGO_CONTAINER = 'certproof-screenshot-mongo';
const MONGO_DB = 'certproof_screenshot';
const MONGO_URI = `mongodb://127.0.0.1:${SCREENSHOT_MONGO_PORT}/${MONGO_DB}`;
const SESSION_SECRET = 'certproof_screenshot_session_secret_32bytes_long!';

const ADMIN_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ISSUER_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';

const adminAccount = privateKeyToAccount(ADMIN_PK);
const issuerAccount = privateKeyToAccount(ISSUER_PK);

const anvilChain = {
  id: 31337,
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC_URL] } },
};

let anvilProc = null;
let nextProc = null;
let browser = null;

function cleanup() {
  console.log('[Cleanup] Stopping all screenshot generation services...');
  if (browser) {
    try { browser.close(); } catch {}
  }
  if (nextProc) {
    try {
      process.kill(-nextProc.pid, 'SIGTERM');
    } catch {}
  }
  if (anvilProc) {
    try { anvilProc.kill('SIGTERM'); } catch {}
  }
  try {
    execSync(`docker rm -f ${MONGO_CONTAINER}`, { stdio: 'ignore' });
  } catch {}
}

process.on('SIGINT', () => { cleanup(); process.exit(1); });
process.on('SIGTERM', () => { cleanup(); process.exit(1); });

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function isPortReachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(1000) });
    return res.ok || res.status === 404 || res.status === 200 || res.status === 304;
  } catch {
    return false;
  }
}

async function main() {
  console.log('===============================================================');
  console.log(' CertProof — Capturing Real Application Portfolio Screenshots');
  console.log('===============================================================');

  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

  try {
    // 1. Launch Ephemeral Anvil Node
    console.log(`[1/6] Launching isolated Anvil node on port ${SCREENSHOT_ANVIL_PORT}...`);
    const anvilBin = `${process.env.HOME}/.foundry/bin/anvil`;
    anvilProc = spawn(anvilBin, ['--port', String(SCREENSHOT_ANVIL_PORT), '--silent']);

    for (let i = 0; i < 30; i++) {
      await sleep(200);
      try {
        const res = await fetch(ANVIL_RPC_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
        });
        if (res.ok) break;
      } catch {}
    }
    console.log('  ✓ Anvil node is active.');

    // 2. Launch Ephemeral MongoDB
    console.log(`[2/6] Launching isolated MongoDB container on port ${SCREENSHOT_MONGO_PORT}...`);
    try { execSync(`docker rm -f ${MONGO_CONTAINER}`, { stdio: 'ignore' }); } catch {}
    execSync(`docker run -d --name ${MONGO_CONTAINER} -p ${SCREENSHOT_MONGO_PORT}:27017 mongo:7.0`, { stdio: 'ignore' });

    for (let i = 0; i < 30; i++) {
      await sleep(300);
      try {
        const client = new MongoClient(MONGO_URI, { connectTimeoutMS: 1000 });
        await client.connect();
        await client.close();
        break;
      } catch {}
    }
    console.log('  ✓ MongoDB container is active.');

    // 3. Deploy Contract & Seed Synthetic Data
    console.log('[3/6] Deploying contract and seeding synthetic certificates...');
    const artifactPath = path.join(ROOT_DIR, 'contracts', 'out', 'CertProofRegistry.sol', 'CertProofRegistry.json');
    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const hashesJson = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'hashes.json'), 'utf8'));

    const publicClient = createPublicClient({
      chain: anvilChain,
      transport: http(ANVIL_RPC_URL),
    });

    const adminWallet = createWalletClient({
      account: adminAccount,
      chain: anvilChain,
      transport: http(ANVIL_RPC_URL),
    });

    const issuerWallet = createWalletClient({
      account: issuerAccount,
      chain: anvilChain,
      transport: http(ANVIL_RPC_URL),
    });

    // Deploy contract
    const deployTx = await adminWallet.deployContract({
      abi: artifact.abi,
      bytecode: artifact.bytecode.object,
      args: [adminAccount.address],
    });
    const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
    const registryAddress = deployReceipt.contractAddress;
    console.log(`  ✓ Deployed contract at ${registryAddress}`);

    // Authorize issuer
    const authTx = await adminWallet.writeContract({
      address: registryAddress,
      abi: artifact.abi,
      functionName: 'setIssuerAuthorization',
      args: [issuerAccount.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });
    console.log(`  ✓ Authorized issuer ${issuerAccount.address}`);

    // Cert 1: Active certificate matching original.pdf
    const certId1 = '0x1111111111111111111111111111111111111111111111111111111111111111';
    const docHash1 = hashesJson.files.original.keccak256;
    const reg1Tx = await issuerWallet.writeContract({
      address: registryAddress,
      abi: artifact.abi,
      functionName: 'registerCertificate',
      args: [certId1, docHash1],
    });
    await publicClient.waitForTransactionReceipt({ hash: reg1Tx });
    console.log(`  ✓ Registered Certificate 1: ${certId1}`);

    // Cert 2: Revoked certificate
    const certId2 = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const docHash2 = hashesJson.files.modified.keccak256;
    const reg2Tx = await issuerWallet.writeContract({
      address: registryAddress,
      abi: artifact.abi,
      functionName: 'registerCertificate',
      args: [certId2, docHash2],
    });
    await publicClient.waitForTransactionReceipt({ hash: reg2Tx });

    const revokeTx = await issuerWallet.writeContract({
      address: registryAddress,
      abi: artifact.abi,
      functionName: 'revokeCertificate',
      args: [certId2],
    });
    await publicClient.waitForTransactionReceipt({ hash: revokeTx });
    console.log(`  ✓ Registered and Revoked Certificate 2: ${certId2}`);

    // Seed SIWE session in MongoDB
    const testSessionToken = 'screenshot_synthetic_session_token_1234567890abcdef1234567890';
    const tokenHash = crypto.createHash('sha256').update(testSessionToken).digest('hex');

    const mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    const db = mongoClient.db(MONGO_DB);
    await db.collection('sessions').insertOne({
      sessionTokenHash: tokenHash,
      walletAddress: issuerAccount.address.toLowerCase(),
      chainId: 31337,
      issuedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
      lastActiveAt: new Date(),
    });
    await mongoClient.close();
    console.log(`  ✓ Seeded SIWE session for ${issuerAccount.address}`);

    // 4. Start Next.js Application Server
    console.log(`[4/6] Starting Next.js application on port ${SCREENSHOT_APP_PORT}...`);
    const appEnv = {
      ...process.env,
      PORT: String(SCREENSHOT_APP_PORT),
      NEXT_PUBLIC_APP_URL: APP_URL,
      NEXT_PUBLIC_CHAIN_ID: '31337',
      NEXT_PUBLIC_REGISTRY_ADDRESS: registryAddress,
      NEXT_PUBLIC_ANVIL_RPC_URL: ANVIL_RPC_URL,
      MONGODB_URI: MONGO_URI,
      SESSION_SECRET,
      SERVER_RPC_URL: ANVIL_RPC_URL,
      NODE_ENV: 'production',
    };

    nextProc = spawn('npx', ['next', 'start', '-p', String(SCREENSHOT_APP_PORT)], {
      cwd: FRONTEND_DIR,
      env: appEnv,
      detached: true,
      stdio: 'pipe',
    });

    for (let i = 0; i < 40; i++) {
      await sleep(250);
      if (await isPortReachable(APP_URL)) break;
    }
    if (!(await isPortReachable(APP_URL))) {
      throw new Error('Timeout waiting for Next.js app server');
    }
    console.log('  ✓ Next.js server is active.');

    // 5. Launch Real Chrome or Playwright Chromium
    console.log('[5/6] Launching browser via Playwright...');
    const launchOptions = {
      headless: true,
      args: ['--window-size=1280,840'],
    };
    if (fs.existsSync(CHROME_PATH)) {
      launchOptions.executablePath = CHROME_PATH;
    }
    browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      viewport: { width: 1280, height: 840 },
      deviceScaleFactor: 2, // crisp HiDPI screenshots
    });

    // Set authenticated session cookie for issuer views
    await context.addCookies([
      {
        name: 'certproof_session',
        value: testSessionToken,
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    // Inject mock EIP-1193 window.ethereum provider for Issuer 1
    await context.addInitScript(({ rpcUrl, address }) => {
      window.ethereum = {
        isMetaMask: true,
        chainId: '0x7a69',
        networkVersion: '31337',
        selectedAddress: address,
        request: async ({ method, params }) => {
          if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
            return [address];
          }
          if (method === 'eth_chainId') return '0x7a69';
          if (method === 'net_version') return '31337';
          const res = await fetch(rpcUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
          });
          const d = await res.json();
          return d.result;
        },
        on: () => {},
        removeListener: () => {},
      };
    }, { rpcUrl: ANVIL_RPC_URL, address: issuerAccount.address });

    const page = await context.newPage();

    // Screenshot 1: Public verifier before file selection
    console.log('\n[Capture 1/4] Capturing: Public Verifier before candidate file selection...');
    const verify1Url = `${APP_URL}/verify/${certId1}?chainId=31337&registry=${registryAddress}`;
    await page.goto(verify1Url, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=Registration Record');
    await page.waitForSelector('text=DOCUMENT HAS NOT BEEN COMPARED');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '01-public-verifier-initial.png'),
      fullPage: false,
    });
    console.log('  ✓ Saved: docs/screenshots/01-public-verifier-initial.png');

    // Screenshot 2: Matching PDF
    console.log('\n[Capture 2/4] Capturing: Public Verifier with Byte-For-Byte Matching PDF...');
    const originalPdfPath = path.join(FIXTURES_DIR, 'original.pdf');
    await page.setInputFiles('#verifier-pdf-input', originalPdfPath);
    await page.waitForSelector('text=BYTE-FOR-BYTE IDENTICAL', { timeout: 10000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '02-public-verifier-matching.png'),
      fullPage: false,
    });
    console.log('  ✓ Saved: docs/screenshots/02-public-verifier-matching.png');

    // Screenshot 3: Revoked certificate with its independent status facts
    console.log('\n[Capture 3/4] Capturing: Public Verifier with Revoked Certificate...');
    const verify2Url = `${APP_URL}/verify/${certId2}?chainId=31337&registry=${registryAddress}`;
    await page.goto(verify2Url, { waitUntil: 'networkidle' });
    await page.waitForSelector('text=REVOKED');
    await page.waitForSelector('text=CERTIFICATE PERMANENTLY REVOKED');
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '03-public-verifier-revoked.png'),
      fullPage: false,
    });
    console.log('  ✓ Saved: docs/screenshots/03-public-verifier-revoked.png');

    // Screenshot 4: Issuer dashboard certificate list
    console.log('\n[Capture 4/4] Capturing: Issuer Dashboard Certificate List...');
    await page.goto(`${APP_URL}/issuer`, { waitUntil: 'networkidle' });
    // Wait for issuer certificate table to load records
    await page.waitForSelector('text=Issued Certificates', { timeout: 10000 });
    await page.waitForSelector('table', { timeout: 10000 });
    await sleep(1500); // Allow react-query table render
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, '04-issuer-certificate-list.png'),
      fullPage: false,
    });
    console.log('  ✓ Saved: docs/screenshots/04-issuer-certificate-list.png');

    console.log('\n===============================================================');
    console.log(' ✔ ALL 4 REAL PORTFOLIO SCREENSHOTS CAPTURED CLEANLY');
    console.log('===============================================================');
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error('\n[SCREENSHOT ERROR]', err);
  process.exit(1);
});
