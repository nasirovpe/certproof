# CertProof — Pre-Publication Verification & Correction Report

**Document Purpose:** Bounded Pre-Publication Correction Pass & Readiness Audit  
**Date:** 2026-10-29  
**Execution Runtime:** Node.js `v22.23.2` / npm `10.9.8` / Foundry `1.8.6`  
**Classification:** Unaudited Educational Reference Implementation / EVM Testnet Prototype  
**Important Notice:** Clean automated test suites and reproducible Docker packaging demonstrate functional adherence to specification, but do not substitute for a formal third-party smart contract security audit or application penetration review. No public mainnet deployment or real-asset broadcast is authorized.

---

## 1. Executive Summary & Verification Matrix

This correction pass audits and resolves all discrepancies identified in sprint reports, aligns the Node runtime schedule, resolves Git provenance claims, enforces explicit local-only development credentials, documents the prior Docker cleanup incident, prepares a clear manual wallet acceptance handoff, and verifies all modified components.

### 1.1 Complete Verification Matrix

| Verification Target | Scope & Tooling | Result | Evidence / Notes |
| :--- | :--- | :---: | :--- |
| **Node.js LTS Alignment** | Package engines, Dockerfile, CI, version files | **ALIGNED** | Node 22 LTS enforced (`engines.node >= 22.0.0`); `.nvmrc` & `.node-version` created (`22`); Node 20 EOL noted. |
| **Git Provenance Audit** | Root & contracts `.git` status, log, remotes | **RESOLVED** | Working-tree status substantiated. Fresh clone claim corrected to isolated working-tree snapshot. Zero commits created. |
| **Publication Candidate** | Tree completeness audit & isolated test | **PASSED** | Isolated snapshot tested in `/tmp/certproof-candidate-snapshot`. 38 Forge tests passed, ABI exported, manifest verified. |
| **Credential Hardening** | `frontend/src/lib/config/env.ts`, `docker-compose.yml` | **HARDENED** | `APP_ENV=local` required for dev defaults on loopback (`127.0.0.1`). Non-local modes strictly reject dev credentials without leaking secrets. |
| **Env Configuration QA** | `frontend/test/env-config.test.ts` (Vitest) | **PASSED** | 14/14 tests passed verifying local defaults, non-local rejections, placeholder detection, and zero-leak error reporting. |
| **Docker Prune Accounting** | Historical log analysis (`af5cdc26...`) | **DOCUMENTED** | Reconstructed `docker image prune -f` and `docker builder prune -f` scope. Daemon-wide impact noted; strict scoped cleanup policy enforced. |
| **Manual Wallet Handoff** | `docs/manual-wallet-acceptance.md` | **PENDING** | Runbook verified. Status marked PENDING due to requirement for human operator & interactive wallet extension. |
| **Smart Contract QA** | Foundry (`forge test -vv`) | **PASSED** | 38/38 tests passed (33 unit, 4 fuzz [256 runs], 1 invariant [2048 calls]). |
| **Frontend Test Suite** | Vitest (`frontend/npm test`) | **PASSED** | 20/20 files, 164/164 tests passed (including on-chain real Anvil integration). |
| **Static Code Quality** | TypeScript (`tsc --noEmit`), ESLint (`next lint`) | **PASSED** | 0 TypeScript errors, 0 ESLint warnings. |
| **Container Production Smoke**| `scripts/smoke-test-package.mjs` (Docker Compose) | **PASSED** | 10/10 phases passed cleanly (multi-stage build, static chunks, Web Worker assets, restart persistence). |
| **Manifest & Bytecode Parity**| `scripts/verify-deployment-manifest.mjs` | **PASSED** | Schema and deployment configurations validated. |
| **Service Teardown** | Host processes & Docker containers | **VERIFIED** | Zero orphan processes, zero active containers, zero lingering ports. |

---

## 2. Node Runtime Schedule & Alignment

### 2.1 Official Node.js Lifecycle Status
An audit of the official Node.js release schedule (`nodejs/release`) confirms:
- **Node.js 20 ("Iron"):** Initial release April 17, 2023. Reached official **End-of-Life (EOL) on April 30, 2026**. Node 20 is completely unsupported and receives no further security patches.
- **Node.js 22 ("Jod"):** Initial release April 24, 2024. Active Maintenance LTS supported through **April 30, 2027**.

### 2.2 Alignment Across Repository Artifacts
Prior documentation claimed Node 22 upgrade while package manifests retained `"engines": { "node": ">=20.18.0" }`, permitting unsupported EOL Node 20 runtimes. The following alignments were made:
1. **Root `package.json`:** Updated engines constraint to `"node": ">=22.0.0"`, `"npm": ">=10.0.0"`.
2. **Frontend `frontend/package.json`:** Updated engines constraint to `"node": ">=22.0.0"`, `"npm": ">=10.0.0"`.
3. **Runtime Version Files:** Created root [`.nvmrc`](file:///Volumes/D%20Disc/WEB3/CertProof/.nvmrc) and [`.node-version`](file:///Volumes/D%20Disc/WEB3/CertProof/.node-version) containing `22`.
4. **Container & CI Parity:** Dockerfile already uses `node:22-alpine` across all stages (`deps`, `builder`, `runner`). GitHub Actions workflow [`.github/workflows/ci.yml`](file:///Volumes/D%20Disc/WEB3/CertProof/.github/workflows/ci.yml) uses `node-version: 22`.
5. **Documentation Alignment:** Updated [`README.md`](file:///Volumes/D%20Disc/WEB3/CertProof/README.md), [`CONTRIBUTING.md`](file:///Volumes/D%20Disc/WEB3/CertProof/CONTRIBUTING.md), and [`docs/toolchain.md`](file:///Volumes/D%20Disc/WEB3/CertProof/docs/toolchain.md) to state explicitly that Node 22 LTS is required and Node 20 reached End-of-Life on April 30, 2026.
6. **Lockfile Stability:** Neither `package-lock.json` nor `frontend/package-lock.json` required modification; all dependencies resolve cleanly under Node `v22.23.2`.

---

## 3. Git Provenance & Publication-Candidate Resolution

### 3.1 Repository State & Provenance Audit
Direct inspection of the Git repositories in the workspace revealed the following:
- **Root Repository (`/Volumes/D Disc/WEB3/CertProof`):**
  - Branch: `main`
  - HEAD Commit: None (`fatal: your current branch 'main' does not have any commits yet`).
  - Tracked Files: None. All 16 root files and directories (`.dockerignore`, `.github/`, `contracts/`, `frontend/`, `docs/`, etc.) exist as untracked files in the working tree.
  - Git Remotes: None configured (`git remote -v` returned empty).
- **Contracts Repository (`/Volumes/D Disc/WEB3/CertProof/contracts`):**
  - Branch: `main`
  - HEAD Commit: None (`fatal: your current branch 'main' does not have any commits yet`).
  - Changes Staged for Commit: `.gitmodules`, `lib/forge-std`, `lib/openzeppelin-contracts`.
  - Untracked Files: `src/`, `test/`, `script/`, `foundry.toml`, `foundry.lock`, `abi/`, etc.
  - Git Remotes: None configured.

### 3.2 Explanation of Earlier Failed `git log` and Claimed Fresh Clone
1. **The Failed `git log`:** An earlier command `git log -n 5` failed with exit code 128 because the Git repository had been initialized with `git init` but no initial commit had ever been created.
2. **The Claimed Fresh Clone:** In `docs/sprint-5-stage-3.md`, section 6.1 claimed:
   > *"Simulated a fresh repository checkout in an isolated directory (`/tmp/certproof-fresh-test`): `git clone . /tmp/certproof-fresh-test && cd /tmp/certproof-fresh-test && git submodule update --init --recursive ...`"*
   
   **Explicit Correction:** Inspection of the execution transcript (`af5cdc26-9586-4c52-b155-9cd92b6f6211`, step 599-600) proves that `git clone` was **not** run. Because the repository had zero commits, `git clone` would have failed to clone any working files. Instead, the prior agent ran `rsync` copying the uncommitted working tree to `/tmp/certproof-fresh-test`, explicitly excluding `.git`, `.next`, and `node_modules`. The earlier claim of a successful "git clone" and "git submodule update" was inaccurate and is hereby corrected.

### 3.3 Publication Candidate Verification via Isolated Working-Tree Snapshot
In accordance with instructions to not create commits, rewrite history, alter remotes, or push, the publication candidate was tested as an isolated working-tree snapshot:
1. Copied candidate tree to `/tmp/certproof-candidate-snapshot` via `rsync` (excluding `.git`, `node_modules`, `frontend/node_modules`, `.next`, `contracts/out`, `contracts/cache`).
2. Executed complete bootstrap and verification under Node 22 and Foundry:
   ```bash
   npm ci
   cd frontend && npm ci && cd ..
   npm run compile
   npm run export-abi
   npm run test
   npm run verify:manifest
   ```
3. **Result:** All 38 Foundry tests passed, ABI JSON/TypeScript bindings were generated identically, and deployment manifest schemas validated. The isolated snapshot was cleanly removed afterward.
4. **Artifact Inventory Confirmed:**
   - Source code: Contracts (`contracts/src/CertProofRegistry.sol`), tests (`contracts/test/`), frontend (`frontend/src/`).
   - Authentic screenshots: `docs/screenshots/01-public-verifier-initial.png` through `04-issuer-certificate-list.png`.
   - Manifests & lockfiles: `package-lock.json`, `frontend/package-lock.json`, `contracts/foundry.lock`, `deployments/local-anvil.json`.
   - CI workflow: `.github/workflows/ci.yml`.
   - Foundry dependencies: Submodules checked out at `contracts/lib/forge-std` and `contracts/lib/openzeppelin-contracts`.

---

## 4. Development Credentials Explicitly Local-Only

### 4.1 Vulnerability Analysis of Prior Defaults
Previously, `frontend/src/lib/config/env.ts` only evaluated `if (NODE_ENV === 'production')`. Because local Docker builds (`Dockerfile` and `docker-compose.yml`) compile and run Next.js in production mode (`NODE_ENV=production`), the application could not distinguish between a local Docker development container and a remote hosted deployment. Consequently, local development defaults could theoretically be accepted in non-local environments if passed without validation, or conversely, local production containers were forced to emulate hosted environments. Furthermore, known placeholder secrets (e.g. `'certproof_local_production_session_secret_32bytes_long'`) passed the length check (`length >= 32`).

### 4.2 Hardened Architecture
The configuration layer was re-architected with explicit environment classification:
1. **Explicit Environment Mode (`APP_ENV`):**
   - Valid values: `'local' | 'development' | 'test' | 'staging' | 'production'`.
   - `IS_LOCAL_DEV`: `true` only when `APP_ENV` is explicitly `'local'`, `'development'`, or `'test'`.
   - If `APP_ENV` is unset and `NODE_ENV === 'production'`, the system defaults safely to non-local (`APP_ENV = 'production'`, `IS_LOCAL_DEV = false`).
2. **Local Convenience Defaults Restricted to Loopback:**
   - In [`docker-compose.yml`](file:///Volumes/D%20Disc/WEB3/CertProof/docker-compose.yml), `APP_ENV: ${APP_ENV:-local}` is declared.
   - All published ports are explicitly bound to the loopback interface:
     - Web application: `127.0.0.1:${APP_PORT:-3010}:3000`
     - MongoDB: `127.0.0.1:${MONGO_PORT:-27017}:27017`
     - Optional Anvil node: `127.0.0.1:${ANVIL_PORT:-8545}:8545`
3. **Strict Non-Local / Staging Enforcement:**
   When `!IS_LOCAL_DEV`:
   - `SESSION_SECRET`: Missing secret, secrets shorter than 32 characters, known development secrets, and placeholder strings (matching `/change[-_]?me|replace[-_]?with|placeholder|dummy|sample[-_]?secret/i`) are fatal errors that halt server startup.
   - `MONGODB_URI`: Missing connection URI, known development passwords (`certproof_local_pass`, `certproof_dev_password`), placeholder values, and unauthenticated connection URIs (missing `username:password`) are fatal errors that halt server startup.
4. **Zero Secret Leakage:**
   Validation error messages never print secret values, database passwords, or connection strings. Errors provide clear remediation instructions without echoing sensitive parameters.
5. **Focused Test Suite:**
   Authored [`frontend/test/env-config.test.ts`](file:///Volumes/D%20Disc/WEB3/CertProof/frontend/test/env-config.test.ts) covering 14 test cases. All 14 tests pass cleanly.

---

## 5. Docker Cleanup Incident Accounting

### 5.1 Incident Reconstruction & Log Findings
Inspection of the historical task logs from conversation `af5cdc26-9586-4c52-b155-9cd92b6f6211` revealed the following sequence of events:
- **Trigger (Step 228):** During execution of `npm run smoke:package`, the Docker build failed with:
  `failed to copy: write /var/lib/docker/... no space left on device`.
- **Diagnostic (Step 231–233):** The agent ran `docker system df` (showing 36.82 GB images, 20.01 GB reclaimable) and `docker ps -a --filter "status=exited"`.
  The host environment contained multiple exited containers from unrelated projects, including `ctfboost-hidden-access-*`, `docker-api-*`, `docker-redis-*`, `docker-postgres-*`, `finance-api-*`, `finance-db-*`, and `scicode-qa-postgres`.
- **Commands Executed:**
  1. `docker image prune -f` (Step 234): Reclaimed 2.831 GB of dangling images across the Docker daemon.
  2. `docker builder prune -f` (Step 241): Reclaimed global BuildKit build cache across the Docker daemon.

### 5.2 Scope & Documented Uncertainty
- **Scope Reality:** The commands executed were daemon-wide global prune commands (`docker image prune -f` and `docker builder prune -f`), **not** scoped to CertProof containers.
- **Uncertainty Disclosure:** While CertProof dangling layers were reclaimed, any dangling image layers or build cache belonging to other projects on the machine were also purged. Because deleted dangling layers are identified only by cryptographic layer SHAs rather than project labels, the full extent of non-CertProof resources pruned cannot be completely reconstructed.
- **Strict Containment Standard:**
  - Zero global prune commands (`docker system prune`, `docker image prune`, `docker builder prune`) are permitted.
  - All cleanup must be strictly scoped using explicit Compose project names (`docker compose -p <project> down -v --rmi local`), container name filters, or recorded container IDs.
  - Named persistent volumes (`mongo_data`, `anvil_data`) and unrelated host resources must remain untouched.

---

## 6. Manual Interactive Wallet Acceptance Handoff

### 6.1 Status & Precise Blocker
The manual acceptance procedures in [`docs/manual-wallet-acceptance.md`](file:///Volumes/D%20Disc/WEB3/CertProof/docs/manual-wallet-acceptance.md) specify human interaction with authentic desktop browser extensions (MetaMask, Rabby).

| Acceptance Flow | Target Verification | Status | Concrete Blocker |
| :--- | :--- | :---: | :--- |
| **Check 1: Connect vs. Authenticate** | Read-only connection vs SIWE modal separation | **PENDING** | Requires interactive browser extension injection and human click approval. |
| **Check 2: Session Persistence** | Browser cookie persistence after page reload | **PENDING** | Requires human-signed SIWE session token in authentic browser. |
| **Check 3: Account & Network Switching**| UI invalidation on extension account/chain change | **PENDING** | Requires extension `accountsChanged` and `chainChanged` events. |
| **Check 4: Registration & Rejection** | User rejection handling in wallet popup | **PENDING** | Requires user clicking "Reject" in wallet confirmation modal. |
| **Check 5: Revocation & Deauthorization**| Issuer revokes; Admin deauthorizes issuer | **PENDING** | Requires multi-account switching within extension popup. |
| **Check 6: Crash & Recovery** | Pending transaction recovery from `sessionStorage` | **PENDING** | Requires browser tab closure during live mempool submission. |
| **Check 7: Public Zero-Wallet Verifier** | QR code sharing and camera scanning | **PENDING** | Requires external device camera scanning rendered QR code. |

> [!IMPORTANT]
> In accordance with project acceptance guidelines, automated scripts or mock wallets have **not** been substituted for authentic extension acceptance. The interactive wallet checks remain formally marked **PENDING**. This limitation does not impede publishing educational source code, provided it is clearly disclosed.

### 6.2 Manual Operator Runbook

#### Local Startup Command
To launch the complete local stack (Next.js production web container, authenticated MongoDB, and scoped Anvil consensus node):
```bash
docker compose --profile local-anvil up -d --build
```

#### Seed Local Registry & Authorize Issuer
In a separate terminal, deploy the registry and pre-authorize Issuer 1:
```bash
npm run demo:local
```

#### Application URLs & Settings
- **Application URL:** `http://localhost:3010` (Issuer dashboard: `http://localhost:3010/issuer`)
- **Anvil RPC Endpoint:** `http://127.0.0.1:8545`
- **Chain ID:** `31337` (Currency symbol: `ETH`)
- **Deployed Registry Address:** `0x5fbdb2315678afecb367f032d93f642f64180aa3`

#### Dedicated Local Test Accounts (Disposable Anvil Keys)
- **Administrator (Account 0):** `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`  
  *Private Key:* `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
- **Authorized Issuer 1 (Account 1):** `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`  
  *Private Key:* `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
- **Unauthorized Account (Account 2):** `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`  
  *Private Key:* `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`

#### Synthetic Test PDF Fixtures
- Original Certificate: [`fixtures/original.pdf`](file:///Volumes/D%20Disc/WEB3/CertProof/fixtures/original.pdf)
- Byte-Identical Duplicate: [`fixtures/duplicate.pdf`](file:///Volumes/D%20Disc/WEB3/CertProof/fixtures/duplicate.pdf)
- Tampered / Modified PDF: [`fixtures/modified.pdf`](file:///Volumes/D%20Disc/WEB3/CertProof/fixtures/modified.pdf)

#### Graceful Local Shutdown Command
To stop all services while preserving persistent database data and blockchain state:
```bash
docker compose --profile local-anvil down
```
*(To additionally reset local database and blockchain state for a clean slate: `docker compose --profile local-anvil down -v`)*

---

## 7. Remaining Publication vs Deployment Blockers

### 7.1 Source Code / Educational Portfolio Publication
- **Status:** **READY FOR PUBLICATION.**
- **Rationale:** All automated unit, fuzz, invariant, container packaging, credential security, and manifest verification checks pass cleanly with zero failures. Repository history and working trees are free of leaked secrets. The documentation accurately reflects working codebase reality and discloses that interactive extension acceptance is pending human testing.

### 7.2 Hosted Application / Staging Deployment
- **Status:** **BLOCKED (PRE-REQUISITES REQUIRED).**
- **Blockers:**
  1. **Manual Interactive Wallet Acceptance:** Must be executed by a human operator with physical browser extensions per [`docs/manual-wallet-acceptance.md`](file:///Volumes/D%20Disc/WEB3/CertProof/docs/manual-wallet-acceptance.md).
  2. **Third-Party Smart Contract Security Audit:** Independent cryptographic review of `CertProofRegistry.sol` must be performed prior to handling real transactions or deploying to public networks.
  3. **Production Secrets Provisioning:** Non-local staging requires cryptographically random secrets (`SESSION_SECRET`, TLS-enabled authenticated MongoDB cluster credentials) provisioned through a secure secrets manager.

---

*Report prepared and verified on Node.js `v22.23.2` under Darwin arm64. All services and test processes stopped cleanly.*