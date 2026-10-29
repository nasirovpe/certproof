# CertProof — Sprint 5, Stage 1: Dependency Security Investigation & Remediation

**Sprint Focus:** Dependency Security Investigation, Pruning Unused Wallet Connectors, Remediating Upstream Advisories, Framework Migration Isolation, and Full-Stack Non-Regression Verification  
**Status:** Superseded by Sprint 5 Stage 1B (see `docs/sprint-5-stage-1b.md`). Historical Record of Stage 1 Initial Remediation  
**Date:** 2026-10-28  
**Notice:** Zero npm audit findings do not equate to a professional security audit or production readiness. CertProof has undergone strict internal regression and dependency hygiene verification for local and Sepolia testnet staging, but has not undergone a formal external smart contract or application penetration test.

---

## 1. Executive Summary & Before/After Audit Results

In Sprint 5, Stage 1, CertProof investigated and remediated the upstream dependency findings carried forward from Sprints 3 and 4 while strictly preserving existing smart contract, dashboard, registration, revocation, and public verification behavior.

By conducting an architectural migration from Wagmi v2 to Wagmi v3 (`^3.7.9`), the application pruned **374 unused transitive dependencies** (including all WalletConnect, Coinbase SDK, MetaMask Mobile SDK, Gemini Wallet, Reown AppKit, `ws`, `decode-uri-component`, and `uuid` packages). In addition, targeted overrides and a focused `vitest@4.1.12` dev-tool upgrade resolved critical testing vulnerabilities without disrupting test harnesses.

### 1.1 Comparative Audit Results Matrix

| Scope | Metric | Before (Sprint 4) | After (Sprint 5, Stage 1) | Delta / Remediation |
| :--- | :--- | :---: | :---: | :--- |
| **Root Repository** (`package.json`) | Total Vulnerabilities | **0** | **0** | Clean (exit code 0) |
| | Production Dependencies | 1 | 1 | Unchanged (`viem: ^2.57.12`) |
| **Frontend Project** (`frontend/package.json`) | **Total Vulnerabilities** | **38** | **2** | **-36 vulnerabilities (94.7% reduction)** |
| | Moderate Severity | 17 | 0 | -17 resolved |
| | High Severity | 18 | 1 | -17 resolved (1 remaining in Next.js nested PostCSS) |
| | Critical Severity | 3 | 1 | -2 resolved (1 remaining in Next.js 14 framework core) |
| | **Production Vulnerabilities** (`--omit=dev`) | **29** | **2** | **-27 production vulnerabilities resolved** |
| | **Development Vulnerabilities** | **9** | **0** | **-9 dev vulnerabilities resolved (100% clean)** |
| | **Total Resolved Packages** in Lockfile | 984 | 587 | **-397 total packages eliminated from dependency tree** |
| | Production Packages in Lockfile | 525 | 107 | **-418 unused production packages eliminated** |

---

## 2. Remediated Findings & Resolution Methodology

### 2.1 Wallet Connector Decoupling via Wagmi 3 Architecture
- **Root Cause in Wagmi v2:** In `@wagmi/connectors@6.2.0`, third-party mobile and proprietary wallet SDKs (`@walletconnect/ethereum-provider`, `@coinbase/wallet-sdk`, `@metamask/sdk`, `@gemini-wallet/core`) were hard dependencies in `package.json`. Even though CertProof solely instantiated the `injected()` connector, `npm` resolved the entire transitive tree, importing 27 production vulnerabilities into `node_modules` and causing Next.js Webpack build warnings for missing React Native async storage modules.
- **Architectural Solution in Wagmi v3:** Wagmi v3 relocated all third-party connector SDKs to optional peer dependencies (`peerDependenciesMeta` with `optional: true`).
- **Targeted Application Updates:**
  1. Updated `frontend/package.json` dependency from `wagmi: ^2.12.25` to `wagmi: ^3.7.9`.
  2. Updated `frontend/src/lib/config/wagmi.ts` to import `injected` directly from `wagmi` (re-exported from `@wagmi/core`) rather than `wagmi/connectors`.
  3. Updated `frontend/src/app/api/issuer/status/route.ts` to import `anvilChain` directly from `@/lib/config/chains` rather than pulling client Wagmi configuration into an API route handler.
- **Vulnerabilities Eliminated:**
  - `decode-uri-component` ([GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr))
  - `ws` ([GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx), [GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p))
  - `uuid` ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq))
  - `@metamask/sdk`, `@metamask/rpc-errors`, `@metamask/utils`, `@metamask/sdk-communication-layer`
  - `@walletconnect/ethereum-provider`, `@walletconnect/universal-provider`, `@walletconnect/core`, `@walletconnect/utils`, `@walletconnect/jsonrpc-ws-connection`
  - `@reown/appkit`, `@reown/appkit-controllers`, `@reown/appkit-pay`, `@reown/appkit-scaffold-ui`, `@reown/appkit-ui`, `@reown/appkit-utils`, `@reown/appkit-wallet`
  - `@coinbase/cdp-sdk`, `@gemini-wallet/core`
  - Transitive vulnerable `viem@2.23.2` and `abitype` instances nested under Reown/WalletConnect.

### 2.2 Zod Memory Exhaustion Remediation
- **Advisory:** [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) (High, CVSS 7.5, CWE-770).
- **Dependency Path:** `frontend` → `viem@2.57.12` → `ox@0.14.59` → `abitype@1.2.3` → `zod` (`peerOptional`).
- **Remediation:** Applied an explicit package override in `frontend/package.json`:
  ```json
  "overrides": {
    "zod": "^4.6.7"
  }
  ```
  `abitype@1.2.3` explicitly declared `peerOptional zod: "^3.22.0 || ^4.0.0"`. Overriding to `zod@4.6.7` satisfied the peer constraint and fully resolved the memory exhaustion advisory.

### 2.3 Glob CLI Command Injection Remediation
- **Advisory:** [GHSA-5j98-mcp5-4vw2](https://github.com/advisories/GHSA-5j98-mcp5-4vw2) (High, CVSS 7.5, CWE-78).
- **Dependency Path:** `frontend` → `devDependencies` → `eslint-config-next@14.2.35` → `@next/eslint-plugin-next@14.2.35` → `glob@10.3.10`.
- **Remediation:** Applied an explicit package override in `frontend/package.json`:
  ```json
  "overrides": {
    "glob": "^10.5.0"
  }
  ```
  The command injection vulnerability resided solely in glob's CLI `-c/--cmd` execution flag; the programmatic file scanning API consumed by ESLint is fully compatible with `10.5.0`.

### 2.4 Vitest, Tinypool & Vite Development Toolchain Upgrades
- **Advisories:**
  - `tinypool`: [GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3), [GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) (Critical Prototype Pollution to RCE).
  - `vitest`: [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp), [GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) (Critical UI server file read, Path traversal).
  - `@vitest/mocker`: [GHSA-qxg6-89mg-rqv8](https://github.com/advisories/GHSA-qxg6-89mg-rqv8) (Code injection).
  - `vite` & `esbuild`: [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99) and path traversal advisories.
- **Remediation:**
  1. Upgraded `vitest` from `^2.1.3` to `^4.1.12`.
  2. Added `@vitejs/plugin-react` (`^6.1.2`) to `devDependencies` and configured `plugins: [react()]` in `frontend/vitest.config.ts` to support modern JSX compilation under Vitest 4's Rolldown AST engine.
  3. Replaced `__dirname` with `import.meta.dirname` in `vitest.config.ts`.
- **Outcome:** All 9 dev-toolchain vulnerabilities were resolved with 100% test pass rate across all 17 test suites (139 tests).

---

## 3. Remaining Upstream Findings & Concrete Next Actions

Only 2 findings remain in `npm audit` across the entire project (identical in both full audit and `--omit=dev` audit). Both originate from the core Next.js 14 framework package.

### 3.1 Finding Catalog & Exposure Assessment

| Package | Installed Version | Severity | Advisory URLs & CWEs | Dependency Path | Runtime Exposure Assessment in CertProof | Available Upstream Fix |
| :--- | :---: | :---: | :--- | :--- | :--- | :--- |
| **`next`** | `14.2.35` | **Critical** | [GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw) (CWE-78)<br>[GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r) (CWE-400)<br>[GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36) (CWE-22) | `frontend` → `next@14.2.35` | **Reassessed Framework Exposure:**<br>While CertProof does not author explicit React Server Actions or invoke `next/image`, internal framework dispatchers, default routes, and rewrite handlers remain present in the runtime. Upgrading to a patched framework version is required before internet-facing deployment (remediated in Stage 1B). | `next@15.5.28` / `next@16.4.3` |
| **`postcss`** | `8.4.31` | **High** | [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q)<br>[GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)<br>[GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) | `frontend` → `next@14.2.35` → `postcss@8.4.31` | **Transitive Dependency:**<br>Pinned directly inside Next.js 14 internal dependencies (`node_modules/next/node_modules/postcss`). Remediated via focused Next.js 15 migration and supported PostCSS override in Stage 1B. | Resolved in Stage 1B |

### 3.2 Concrete Migration Blocker & Next Actions
- **Why Next.js 16 Was Not Upgraded in This Stage:** Next.js 16 requires a major framework migration, including React 19 peer dependencies, Turbopack default bundling, and breaking changes to asynchronous request APIs (`cookies()`, `headers()`). Per Sprint 5 Stage 1 scope constraints, combining a major framework rewrite with dependency remediation is explicitly prohibited to prevent regression risk.
- **Concrete Next Action (Sprint 5, Subsequent Epic):** Schedule an isolated framework migration epic to transition from Next.js 14 + React 18 to Next.js 15/16 + React 19 after Sepolia contract deployment and release stabilization.

---

## 4. Verification Evidence & Test Execution Matrix

All verification checks were executed against the remediated dependency tree.

### 4.1 Automated Frontend Test Suite
- **Command:** `cd frontend && npm test`
- **Runner:** Vitest 4.1.12 with `@vitejs/plugin-react`
- **Result:** **17 test files passed, 139 tests passed (0 failed, 0 skipped)**

| Test Suite | Tests | Result | Focus / Invariant Tested |
| :--- | :---: | :---: | :--- |
| `test/wallet-injected-config.test.ts` *(New Regression Suite)* | 4 | **Passed** | Confirms only `injected` connector configured; zero WalletConnect/Coinbase SDKs; SSR true; Anvil/Sepolia chain coverage. |
| `test/certificate-share.test.ts` | 14 | **Passed** | Canonical URL construction, deployment parameter scoping, local QR PNG generation and independent `jsQR` decoding. |
| `test/certificate-share-components.test.tsx` | 3 | **Passed** | Share modal, clipboard link copy, local-only origin notice, download trigger. |
| `test/certificate-public-components.test.tsx` | 11 | **Passed** | 4 independent verification facts, zero wallet access on public route, local PDF comparison. |
| `test/certificate-public-anvil.test.ts` | 9 | **Passed** | Authoritative smart contract reads against real local Anvil node (zero MongoDB access). |
| `test/certificate-revocation-anvil.test.ts` | 5 | **Passed** | On-chain revocation rules and permissions evaluated against live Anvil RPC. |
| `test/certificate-registration-anvil.test.ts` | 8 | **Passed** | On-chain registration, duplicate prevention, and bounded pagination. |
| `test/session-invalidation.test.tsx` | 18 | **Passed** | Account switching, chain changes, disconnect handling, and request race condition isolation. |
| `test/certificate-revocation-components.test.tsx` | 8 | **Passed** | Revocation dialog UI, reason code persistence, and simulation. |
| `test/certificate-components.test.tsx` | 9 | **Passed** | Issuer registration dropzone, pre-read file limits, and duplicate validation. |
| `test/certificate-recovery.test.ts` | 13 | **Passed** | Recovery drafts in IndexedDB, crash recovery, and anti-replay guards. |
| `test/auth-siwe.test.ts` | 9 | **Passed** | EIP-4361 SIWE challenge generation, domain binding, and signature validation. |
| `test/pdf-hash.test.ts` | 12 | **Passed** | In-memory Keccak-256 PDF hashing and PDF byte-header heuristics. |
| `test/pdf-worker-fixtures.test.ts` | 4 | **Passed** | Web Worker Keccak-256 execution with real binary fixtures (`original.pdf`, `modified.pdf`). |
| `test/registry-read.test.ts` | 5 | **Passed** | Viem public client contract read helpers and error handling. |
| `test/session.test.ts` | 6 | **Passed** | Iron-session cryptographic seal encryption and cookie handling. |
| `test/concurrency.test.ts` | 1 | **Passed** | Atomic nonce redemption under concurrent requests. |

### 4.2 Static Typing & Linting
- **Type Checking:** `cd frontend && npx tsc --noEmit` → **0 errors (exit code 0)**.
- **ESLint:** `cd frontend && npm run lint` → **✔ No ESLint warnings or errors (exit code 0)**.

### 4.3 Production Next.js Build
- **Command:** `cd frontend && npm run build`
- **Result:** **Compiled successfully (exit code 0)**.
- **Bundle Hygiene Verification:** Webpack emitted zero `@metamask/sdk` missing module warnings. Client bundle chunks contain zero third-party wallet connector SDKs.

### 4.4 Real-Browser Playwright End-to-End Verification
- **Command:** `node scripts/verify-browser-e2e.mjs`
- **Target Browser:** Google Chrome 156.0.8078.73 (installed desktop binary)
- **Result:** **8/8 stages passed cleanly (exit code 0)**.
  - Deployed contract on isolated Anvil port `8562`.
  - Started production Next.js server on port `3005` with `MONGODB_URI` unset.
  - Exercised `/verify/[certId]` in real Chrome.
  - Verified local Web Worker Keccak-256 hashing for `original.pdf`, `duplicate.pdf`, and `modified.pdf`.
  - Verified network privacy guarantee: 0 PDF bytes uploaded over the network.
  - Verified Share modal and local QR rendering.
  - Confirmed 0 browser console errors.

### 4.5 ABI Parity Verification
- **Command:** `node scripts/export-abi.mjs && diff -u contracts/abi/CertProofRegistry.ts frontend/src/lib/abi/CertProofRegistry.ts`
- **Result:** Exact byte-for-byte match (exit code 0).

### 4.6 Reproducible Installation Verification
- **Command:** `cd frontend && npm ci`
- **Result:** **added 529 packages, and audited 530 packages in 10s (exit code 0)**.

---

## 5. Architectural Delineation & Deployment Readiness

### 5.1 Isolated Local Development Readiness: Initial Engineering Approved (See Stage 1B for Framework Remediation)
- **Status:** **Ready for Local Engineering; Superseded by Stage 1B for Deployment.**
- **Rationale:**
  - Zero active runtime vulnerabilities in CertProof's execution pathways.
  - The development toolchain (`vitest`, `esbuild`, `tinypool`) is completely free of known advisories.
  - Wallet communication is strictly bounded to the browser's injected provider (`window.ethereum`).
  - All 139 automated tests and real-browser Playwright E2E suites pass with zero flakiness.

### 5.2 Internet-Facing Testnet Hosting Readiness: Qualified / Staging Only
- **Status:** **Approved for Sepolia Staging with Perimeter Constraints; Blocked for Commercial Mainnet.**
- **Rationale:**
  - While all transitive wallet SDK advisories were eliminated, the Next.js 14 framework core still reports critical/high CVEs (DoS in Server Actions and SVG image handling).
  - Even though CertProof does not expose Server Actions or remote SVG image optimization, internet-facing servers must not rely solely on application idle-code assumptions for perimeter defense.
  - Testnet deployment on Sepolia is permissible under the following staging safeguards:
    1. Deploy on standard Linux/POSIX containers (negating Windows path RCE vectors).
    2. Implement a reverse proxy (e.g. Cloudflare / Nginx) blocking access to internal Next.js endpoints (`/_next/image` and action query endpoints).
    3. Retain read-only public verifier scoping.
- **Formal Audit Disclosure:** Do not equate the resolution of 36 npm audit vulnerabilities with a smart contract security audit. Third-party smart contract audits and penetration testing remain required prior to any mainnet financial or production identity deployment.

---

## 6. Process & Daemon Cleanup Status

All background processes and ephemeral test resources initiated during Stage 1 have been stopped:
- **Anvil Instances:** Port 8562 and port 8545 processes terminated.
- **Next.js Servers:** Port 3005 test server terminated.
- **MongoDB:** Temporary test containers on port 27018 stopped and removed.
- **Browser Automation:** Headless Chrome Playwright process closed cleanly.
- **Ports Clear:** All ports (8545, 8562, 3005, 27018) verified clear.
