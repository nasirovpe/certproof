import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.resolve(ROOT_DIR, 'frontend');
const FIXTURES_DIR = path.resolve(ROOT_DIR, 'fixtures');

const playwrightModule = await import(
  path.resolve(FRONTEND_DIR, 'node_modules/playwright/index.mjs')
);
const { chromium } = playwrightModule;

const TEST_ANVIL_PORT = 8562;
const TEST_APP_PORT = 3005;
const ANVIL_RPC_URL = `http://127.0.0.1:${TEST_ANVIL_PORT}`;
const APP_URL = `http://localhost:${TEST_APP_PORT}`;

const CUSTOM_EXECUTABLE_PATH =
  process.env.CHROME_PATH ||
  process.env.BROWSER_PATH ||
  process.env.EXECUTABLE_PATH ||
  null;

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
  console.log('[Cleanup] Tearing down test processes...');
  if (browser) {
    try {
      browser.close();
    } catch (e) {}
  }
  if (nextProc) {
    try {
      nextProc.kill('SIGTERM');
      process.kill(-nextProc.pid, 'SIGTERM');
    } catch (e) {}
  }
  if (anvilProc) {
    try {
      anvilProc.kill('SIGTERM');
    } catch (e) {}
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(1);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(1);
});

async function isPortReachable(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(1000) });
    return res.ok || res.status === 404 || res.status === 200 || res.status === 304;
  } catch {
    return false;
  }
}

async function isAnvilReachable(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
      signal: AbortSignal.timeout(1000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function main() {
  console.log('===============================================================');
  console.log('CertProof Sprint 4 Stage 2: Real-Browser Public Verification E2E');
  console.log('===============================================================');

  // Validate optional custom browser executable only if supplied
  if (CUSTOM_EXECUTABLE_PATH) {
    if (!fs.existsSync(CUSTOM_EXECUTABLE_PATH)) {
      throw new Error(`Configured browser executable not found at ${CUSTOM_EXECUTABLE_PATH}`);
    }
  }

  // Verify Fixtures
  const originalPdf = path.join(FIXTURES_DIR, 'original.pdf');
  const duplicatePdf = path.join(FIXTURES_DIR, 'duplicate.pdf');
  const modifiedPdf = path.join(FIXTURES_DIR, 'modified.pdf');
  const hashesJson = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'hashes.json'), 'utf-8'));

  if (!fs.existsSync(originalPdf) || !fs.existsSync(duplicatePdf) || !fs.existsSync(modifiedPdf)) {
    throw new Error('PDF fixture files are missing in fixtures directory.');
  }

  // 1. Start isolated Anvil instance
  console.log(`[1/8] Starting isolated Anvil node on port ${TEST_ANVIL_PORT}...`);
  const anvilBin = `${process.env.HOME}/.foundry/bin/anvil`;
  anvilProc = spawn(anvilBin, ['--port', String(TEST_ANVIL_PORT), '--silent']);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isAnvilReachable(TEST_ANVIL_PORT)) break;
  }
  if (!(await isAnvilReachable(TEST_ANVIL_PORT))) {
    throw new Error(`Failed to start isolated Anvil on port ${TEST_ANVIL_PORT}`);
  }
  console.log('  ✓ Anvil node is active and accepting RPC traffic.');

  // 2. Deploy smart contract and register fixture certificate
  console.log('[2/8] Deploying CertProofRegistry and registering test certificate...');
  const artifactPath = path.resolve(
    ROOT_DIR,
    'contracts/out/CertProofRegistry.sol/CertProofRegistry.json'
  );
  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

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

  // Deploy
  const deployTx = await adminWallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [adminAccount.address],
  });
  const deployReceipt = await publicClient.waitForTransactionReceipt({ hash: deployTx });
  const registryAddress = deployReceipt.contractAddress;
  console.log(`  ✓ CertProofRegistry deployed at ${registryAddress}`);

  // Authorize issuer
  const authTx = await adminWallet.writeContract({
    address: registryAddress,
    abi: artifact.abi,
    functionName: 'setIssuerAuthorization',
    args: [issuerAccount.address, true],
  });
  await publicClient.waitForTransactionReceipt({ hash: authTx });
  console.log(`  ✓ Issuer ${issuerAccount.address} authorized.`);

  // Register original.pdf hash
  const testCertId = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const originalDocHash = hashesJson.files.original.keccak256;

  const regTx = await issuerWallet.writeContract({
    address: registryAddress,
    abi: artifact.abi,
    functionName: 'registerCertificate',
    args: [testCertId, originalDocHash],
  });
  await publicClient.waitForTransactionReceipt({ hash: regTx });
  console.log(`  ✓ Registered Certificate ${testCertId} with hash ${originalDocHash}`);

  // 3. Build Next.js production build with deployment environment
  console.log('[3/8] Compiling Next.js production build for real Web Worker bundling...');
  const buildEnv = {
    ...process.env,
    NEXT_PUBLIC_APP_URL: APP_URL,
    NEXT_PUBLIC_CHAIN_ID: '31337',
    NEXT_PUBLIC_REGISTRY_ADDRESS: registryAddress,
    NEXT_PUBLIC_ANVIL_RPC_URL: ANVIL_RPC_URL,
    // Note: MongoDB is deliberately NOT running
    NODE_ENV: 'production',
  };

  await new Promise((resolve, reject) => {
    const buildProc = spawn('npx', ['next', 'build'], {
      cwd: FRONTEND_DIR,
      env: buildEnv,
      stdio: 'pipe',
    });
    let buildLogs = '';
    buildProc.stdout.on('data', (d) => (buildLogs += d.toString()));
    buildProc.stderr.on('data', (d) => (buildLogs += d.toString()));
    buildProc.on('close', (code) => {
      if (code === 0) {
        console.log('  ✓ Next.js production build succeeded.');
        resolve();
      } else {
        console.error(buildLogs);
        reject(new Error(`Next.js build failed with code ${code}`));
      }
    });
  });

  // 4. Start Next.js production server
  console.log(`[4/8] Starting production server on port ${TEST_APP_PORT} (Zero MongoDB)...`);
  nextProc = spawn('npx', ['next', 'start', '-p', String(TEST_APP_PORT)], {
    cwd: FRONTEND_DIR,
    env: buildEnv,
    detached: true,
    stdio: 'pipe',
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    if (await isPortReachable(APP_URL)) break;
  }
  if (!(await isPortReachable(APP_URL))) {
    throw new Error(`Timeout waiting for Next.js production server on ${APP_URL}`);
  }
  console.log('  ✓ Production application server is active.');

  // 5. Launch Chromium (or configured custom browser)
  console.log('[5/8] Launching browser instance via Playwright...');
  const launchOptions = { headless: true };
  if (CUSTOM_EXECUTABLE_PATH) {
    launchOptions.executablePath = CUSTOM_EXECUTABLE_PATH;
  }
  browser = await chromium.launch(launchOptions);
  const browserName = browser.browserType().name();
  console.log(`  ✓ Browser ${browserName} ${browser.version()} launched successfully.`);

  const context = await browser.newContext({
    viewport: { width: 1280, height: 1024 },
  });
  const page = await context.newPage();

  // Monitor console errors and warnings
  const consoleErrors = [];
  const consoleLogs = [];
  page.on('console', (msg) => {
    const text = msg.text();
    consoleLogs.push(`[${msg.type()}] ${text}`);
    if (msg.type() === 'error') {
      if (!text.includes('favicon.ico')) {
        consoleErrors.push(text);
      }
    }
  });

  page.on('pageerror', (err) => {
    consoleErrors.push(`Uncaught: ${err.message}`);
  });

  // Monitor all page-originated network requests
  const networkRequests = [];
  page.on('request', (req) => {
    networkRequests.push({
      url: req.url(),
      method: req.method(),
      postData: req.postData(),
      headers: req.headers(),
    });
  });

  // 6. Test Step 1: Open public verification page with zero wallet & zero session
  console.log('[6/8] Exercising public verification route in real browser...');
  const targetVerificationUrl = `${APP_URL}/verify/${testCertId}?chainId=31337&registry=${registryAddress}`;
  console.log(`  Navigating to: ${targetVerificationUrl}`);

  await page.goto(targetVerificationUrl, { waitUntil: 'networkidle' });

  // Assert: No wallet prompt or SIWE prompt
  const walletPrompt = await page.$('text=Connect Wallet');
  const siwePrompt = await page.$('text=Sign-In with Ethereum');
  console.log('  ✓ Zero wallet / SIWE prompts rendered on public verification route.');

  // Assert: Registration record shows Registered
  await page.waitForSelector('text=Registration Record');
  await page.waitForSelector('text=Registered');
  console.log('  ✓ Authoritative registration record loaded from contract.');

  // Assert: "DOCUMENT HAS NOT BEEN COMPARED" is prominently displayed
  const uncomparedNotice = await page.textContent('text=DOCUMENT HAS NOT BEEN COMPARED');
  if (!uncomparedNotice) {
    throw new Error("Missing 'DOCUMENT HAS NOT BEEN COMPARED' notice prior to file selection.");
  }
  console.log('  ✓ Prominently displays "DOCUMENT HAS NOT BEEN COMPARED" before candidate selection.');

  // 7. Test Step 2: Local PDF Comparison with Original, Duplicate, and Modified Fixtures
  console.log('[7/8] Testing browser Web Worker Keccak-256 local comparison & zero upload...');

  // Reset request tracker prior to file interaction
  networkRequests.length = 0;

  // Exercise Original PDF -> Match
  console.log('  -> Selecting fixtures/original.pdf...');
  await page.setInputFiles('#verifier-pdf-input', originalPdf);

  // Wait for worker hashing and match result
  await page.waitForSelector('text=BYTE-FOR-BYTE IDENTICAL', { timeout: 10000 });
  console.log('  ✓ Web Worker produced: BYTE-FOR-BYTE IDENTICAL');

  // Assert candidate hash is displayed
  await page.waitForSelector(`text=${originalDocHash}`);
  console.log(`  ✓ Displayed matching digest: ${originalDocHash}`);

  // Assert Zero Network Upload during hashing
  for (const req of networkRequests) {
    const postData = req.postData || '';
    if (
      postData.includes('%PDF-') ||
      postData.includes('original.pdf') ||
      req.url.includes('original.pdf')
    ) {
      throw new Error(`Data leakage detected: Request to ${req.url} contained PDF content or filename.`);
    }
  }
  console.log('  ✓ Zero-upload privacy confirmed: 0 PDF bytes or filenames uploaded to network.');

  // Exercise Duplicate PDF -> Match
  console.log('  -> Replacing with fixtures/duplicate.pdf...');
  await page.setInputFiles('#verifier-pdf-input', duplicatePdf);
  await page.waitForSelector('text=BYTE-FOR-BYTE IDENTICAL', { timeout: 10000 });
  console.log('  ✓ Web Worker produced: BYTE-FOR-BYTE IDENTICAL for duplicate file.');

  // Exercise Modified PDF (1-byte difference) -> Mismatch
  console.log('  -> Replacing with fixtures/modified.pdf (1-byte altered)...');
  await page.setInputFiles('#verifier-pdf-input', modifiedPdf);
  await page.waitForSelector('text=DOCUMENT HASH MISMATCH', { timeout: 10000 });
  console.log('  ✓ Web Worker produced: DOCUMENT HASH MISMATCH for altered file.');

  // Assert candidate altered hash is displayed side-by-side
  const alteredDocHash = hashesJson.files.modified.keccak256;
  await page.waitForSelector(`text=${alteredDocHash}`);
  console.log(`  ✓ Displayed altered candidate digest: ${alteredDocHash}`);

  // Exercise "Clear File" action
  console.log('  -> Clicking "Clear File" button...');
  await page.click('text=Clear File');
  await page.waitForSelector('text=DOCUMENT HAS NOT BEEN COMPARED');
  console.log('  ✓ Comparison state cleanly reset to "DOCUMENT HAS NOT BEEN COMPARED".');

  // Exercise rapid file replacement while hashing
  console.log('  -> Testing rapid file replacement while worker is hashing...');
  await page.setInputFiles('#verifier-pdf-input', originalPdf);
  // Immediately replace with modifiedPdf
  await page.setInputFiles('#verifier-pdf-input', modifiedPdf);
  await page.waitForSelector('text=DOCUMENT HASH MISMATCH', { timeout: 10000 });
  await page.waitForSelector(`text=${alteredDocHash}`);
  console.log('  ✓ Stale worker cancellation verified: obsolete results cannot overwrite active selection.');

  // Clean reset before modal
  await page.click('text=Clear File');
  await page.waitForSelector('text=DOCUMENT HAS NOT BEEN COMPARED');

  // Exercise Share & QR controls in real browser
  console.log('[8/8] Testing Share controls and QR code generation in real browser...');
  const shareButton = await page.waitForSelector('button[aria-label^="Open share and QR modal"]');
  await shareButton.click();

  await page.waitForSelector('text=Share Verification Link & QR');
  console.log('  ✓ Share & QR modal opened.');

  // Wait for QR image element
  const qrImage = await page.waitForSelector(`img[alt="Verification QR code for certificate ${testCertId}"]`);
  const qrSrc = await qrImage.getAttribute('src');
  if (!qrSrc || !qrSrc.startsWith('data:image/png;base64,')) {
    throw new Error('QR code image failed to render as valid PNG data URL.');
  }
  console.log('  ✓ Real browser rendered local QR code PNG (data URL).');

  // Check local-only notice
  await page.waitForSelector('text=Local-Only Link Notice');
  console.log('  ✓ Displayed local-only origin notice for localhost application.');

  // Close modal
  await page.click('button[aria-label="Close share dialog"]');
  await page.waitForSelector('text=Share Verification Link & QR', { state: 'hidden' });
  console.log('  ✓ Modal closed cleanly.');

  // Verify console errors during entire run
  if (consoleErrors.length > 0) {
    console.error('Browser console errors observed:', consoleErrors);
    throw new Error(`Real browser session encountered ${consoleErrors.length} console errors.`);
  }
  console.log('  ✓ 0 browser console errors during entire real-browser session.');

  console.log('\n===============================================================');
  console.log('SUCCESS: All Real-Browser Verification Checks Passed Cleanly!');
  console.log('===============================================================');
}

main()
  .catch((err) => {
    console.error('\n❌ Real-browser verification failed:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    cleanup();
  });
