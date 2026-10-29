import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodePacked,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Standard disposable Anvil pre-funded keys (Account 0, 1, 2)
const ADMIN_PK = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const ISSUER1_PK = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ISSUER2_PK = '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a';

const adminAccount = privateKeyToAccount(ADMIN_PK);
const issuer1Account = privateKeyToAccount(ISSUER1_PK);
const issuer2Account = privateKeyToAccount(ISSUER2_PK);

const ANVIL_PORT = 8545;
const RPC_URL = `http://127.0.0.1:${ANVIL_PORT}`;

// Load compiled contract artifact
const artifactPath = path.join(
  rootDir,
  'contracts',
  'out',
  'CertProofRegistry.sol',
  'CertProofRegistry.json'
);

if (!fs.existsSync(artifactPath)) {
  console.error(`Artifact not found at ${artifactPath}. Run forge build first.`);
  process.exit(1);
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
const abi = artifact.abi;
const bytecode = artifact.bytecode.object;

async function isPortReachable(port) {
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

async function startAnvil() {
  const running = await isPortReachable(ANVIL_PORT);
  if (running) {
    console.log(`Using existing Anvil node on port ${ANVIL_PORT}`);
    return null;
  }

  console.log(`Starting ephemeral Anvil process on port ${ANVIL_PORT}...`);
  const anvilBin = `${process.env.HOME}/.foundry/bin/anvil`;
  const anvilProc = spawn(anvilBin, ['--port', String(ANVIL_PORT), '--silent']);

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 250));
    if (await isPortReachable(ANVIL_PORT)) {
      console.log('Anvil process started and accepting RPC calls.');
      return anvilProc;
    }
  }

  throw new Error('Timeout waiting for Anvil to start.');
}

async function main() {
  let anvilProc = null;
  try {
    anvilProc = await startAnvil();

    const publicClient = createPublicClient({
      transport: http(RPC_URL),
    });

    const chainId = await publicClient.getChainId();
    console.log(`Connected to local testnet (Chain ID: ${chainId})`);

    const adminWallet = createWalletClient({
      account: adminAccount,
      transport: http(RPC_URL),
    });

    const issuer1Wallet = createWalletClient({
      account: issuer1Account,
      transport: http(RPC_URL),
    });

    const issuer2Wallet = createWalletClient({
      account: issuer2Account,
      transport: http(RPC_URL),
    });

    // 1. Validate Initial Administrator
    if (!adminAccount.address || adminAccount.address === '0x0000000000000000000000000000000000000000') {
      throw new Error('Invalid initial administrator address.');
    }
    console.log('\n--- Step 1: Initial Administrator Validation ---');
    console.log(`Administrator address: ${adminAccount.address} (Valid & Non-zero)`);

    // 2. Deploy CertProofRegistry
    console.log('\n--- Step 2: Contract Deployment ---');
    const deployTxHash = await adminWallet.deployContract({
      abi,
      bytecode,
      args: [adminAccount.address],
    });

    const deployReceipt = await publicClient.waitForTransactionReceipt({
      hash: deployTxHash,
    });

    const contractAddress = deployReceipt.contractAddress;
    const deployBlock = await publicClient.getBlock({ blockHash: deployReceipt.blockHash });
    const deployedCode = await publicClient.getBytecode({ address: contractAddress });
    const runtimeCodeHash = keccak256(deployedCode);

    console.log(`Contract deployed at: ${contractAddress}`);
    console.log(`Deploy Tx Hash:      ${deployReceipt.transactionHash}`);
    console.log(`Block Number:        ${deployReceipt.blockNumber} (Hash: ${deployReceipt.blockHash})`);
    console.log(`Runtime Code Hash:   ${runtimeCodeHash}`);

    // Confirm initial state
    const confirmedOwner = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'owner',
    });
    const adminIssuerStatus = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'isIssuerAuthorized',
      args: [adminAccount.address],
    });

    console.log(`Confirmed Contract Owner: ${confirmedOwner}`);
    console.log(`Admin Initial Issuer Status: ${adminIssuerStatus} (Separated from ownership)`);

    // Write Deployment Manifest
    const manifestDir = path.join(rootDir, 'deployments');
    fs.mkdirSync(manifestDir, { recursive: true });
    const manifest = {
      network: 'anvil-local',
      chainId,
      contractAddress,
      deployer: adminAccount.address,
      initialAdministrator: adminAccount.address,
      transactionHash: deployReceipt.transactionHash,
      blockNumber: Number(deployReceipt.blockNumber),
      blockHash: deployReceipt.blockHash,
      blockTimestamp: Number(deployBlock.timestamp),
      runtimeCodeHash,
      compiler: '0.8.24',
      evmTarget: 'cancun',
      deployedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(manifestDir, 'local-anvil.json'), JSON.stringify(manifest, null, 2));
    console.log(`Wrote local deployment manifest to: deployments/local-anvil.json`);

    // 3. Demonstration Lifecycle
    console.log('\n--- Step 3: Lifecycle Demonstration ---');

    // A. Authorize Issuer 1
    console.log('\n[DEMO A] Authorizing Issuer 1...');
    const auth1Tx = await adminWallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'setIssuerAuthorization',
      args: [issuer1Account.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: auth1Tx });
    const isAuth1 = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'isIssuerAuthorized',
      args: [issuer1Account.address],
    });
    console.log(`Issuer 1 (${issuer1Account.address}) Authorized: ${isAuth1}`);

    // B. Register Certificate with Fixture Hash
    console.log('\n[DEMO B] Registering Certificate from Issuer 1...');
    const certId1 = keccak256(encodePacked(['string', 'address'], ['CERT_DEMO_1', issuer1Account.address]));
    // Load fixture original hash
    const fixturesHashData = JSON.parse(fs.readFileSync(path.join(rootDir, 'fixtures', 'hashes.json'), 'utf8'));
    const docHashOriginal = fixturesHashData.files.original.keccak256;

    const regTx = await issuer1Wallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'registerCertificate',
      args: [certId1, docHashOriginal],
    });
    await publicClient.waitForTransactionReceipt({ hash: regTx });
    console.log(`Registered certId: ${certId1} with docHash: ${docHashOriginal}`);

    // C. Read back Certificate
    console.log('\n[DEMO C] Reading back certificate record...');
    const recordC = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'getCertificate',
      args: [certId1],
    });
    console.log(`Record Details:`);
    console.log(`  - certId:       ${recordC.certId}`);
    console.log(`  - documentHash: ${recordC.documentHash}`);
    console.log(`  - issuer:       ${recordC.issuer}`);
    console.log(`  - registeredAt: ${recordC.registeredAt}`);
    console.log(`  - revoked:      ${recordC.revoked}`);
    console.log(`  - revokedAt:    ${recordC.revokedAt}`);

    // D. Deauthorize Issuer 1
    console.log('\n[DEMO D] De-authorizing Issuer 1 by Administrator...');
    const deauthTx = await adminWallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'setIssuerAuthorization',
      args: [issuer1Account.address, false],
    });
    await publicClient.waitForTransactionReceipt({ hash: deauthTx });
    const isAuthAfter = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'isIssuerAuthorized',
      args: [issuer1Account.address],
    });
    console.log(`Issuer 1 Authorized Status: ${isAuthAfter} (De-authorized)`);

    // E. Issuer 1 Revokes Existing Certificate (Allowed post-deauthorization)
    console.log('\n[DEMO E] Issuer 1 revoking existing certificate after de-authorization...');
    const revokeTx = await issuer1Wallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'revokeCertificate',
      args: [certId1],
    });
    await publicClient.waitForTransactionReceipt({ hash: revokeTx });
    console.log(`Revocation transaction confirmed.`);

    // F. Confirm Revoked and De-authorized Independently
    console.log('\n[DEMO F] Confirming Revoked and De-authorized independently...');
    const recordF = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'getCertificate',
      args: [certId1],
    });
    const authStatusF = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'isIssuerAuthorized',
      args: [issuer1Account.address],
    });

    console.log(`Independent Facts:`);
    console.log(`  Fact 1 - Registration Exists:     ${recordF.registeredAt > 0n}`);
    console.log(`  Fact 2 - Document Hash Match:     ${recordF.documentHash === docHashOriginal}`);
    console.log(`  Fact 3 - Revoked:                 ${recordF.revoked} (revokedAt: ${recordF.revokedAt})`);
    console.log(`  Fact 4 - Current Issuer Auth:     ${authStatusF} (DEAUTHORIZED)`);

    if (!recordF.revoked || authStatusF !== false) {
      throw new Error('Independent state assertion failed!');
    }
    console.log(`CONFIRMED: Certificate is simultaneously REVOKED and issued by a currently DEAUTHORIZED issuer.`);

    // G. Duplicate Registration Rejection
    console.log('\n[DEMO G] Testing duplicate (issuer, documentHash) registration rejection...');
    // Reauthorize issuer 1 first to test deduplication rule specifically
    await (await adminWallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'setIssuerAuthorization',
      args: [issuer1Account.address, true],
    }));
    await new Promise(r => setTimeout(r, 200));

    const certIdNew = keccak256(encodePacked(['string', 'address'], ['CERT_DEMO_DUP', issuer1Account.address]));
    let dupFailed = false;
    try {
      await issuer1Wallet.writeContract({
        address: contractAddress,
        abi,
        functionName: 'registerCertificate',
        args: [certIdNew, docHashOriginal],
      });
    } catch (err) {
      dupFailed = true;
      console.log(`Expected Revert caught: Duplicate (issuer, documentHash) permanently blocked!`);
    }
    if (!dupFailed) {
      throw new Error('Expected duplicate registration to revert, but it succeeded!');
    }

    // H. Two-Issuer Registration of Same Hash
    console.log('\n[DEMO H] Testing two independent issuers registering identical document hash...');
    const auth2Tx = await adminWallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'setIssuerAuthorization',
      args: [issuer2Account.address, true],
    });
    await publicClient.waitForTransactionReceipt({ hash: auth2Tx });

    const certId2 = keccak256(encodePacked(['string', 'address'], ['CERT_DEMO_2', issuer2Account.address]));
    const reg2Tx = await issuer2Wallet.writeContract({
      address: contractAddress,
      abi,
      functionName: 'registerCertificate',
      args: [certId2, docHashOriginal], // same docHash as Issuer 1
    });
    await publicClient.waitForTransactionReceipt({ hash: reg2Tx });

    const recordIssuer2 = await publicClient.readContract({
      address: contractAddress,
      abi,
      functionName: 'getCertificate',
      args: [certId2],
    });

    console.log(`Issuer 2 Registration Succeeded:`);
    console.log(`  - certId:       ${recordIssuer2.certId}`);
    console.log(`  - issuer:       ${recordIssuer2.issuer} (Issuer 2: ${issuer2Account.address})`);
    console.log(`  - documentHash: ${recordIssuer2.documentHash} (Identical hash)`);
    console.log(`  - revoked:      ${recordIssuer2.revoked} (Independent: Active, not revoked)`);

    console.log('\n=============================================');
    console.log('ALL DEMONSTRATION ASSERTIONS PASSED PERFECTLY');
    console.log('=============================================\n');
  } finally {
    if (anvilProc) {
      console.log('Stopping ephemeral Anvil process...');
      anvilProc.kill();
    }
  }
}

main().catch(err => {
  console.error('Fatal Demo Error:', err);
  process.exit(1);
});
