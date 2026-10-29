# CertProof — Sprint 4, Stage 2: Deployment-Scoped Verification Links, Downloadable QR Codes & Real-Browser PDF Verification

**Sprint Focus:** Canonical Verification URL Builder (`share.ts`), Deployment Parameter Scoping, Downloadable High-Resolution QR Codes, Share Controls in Issuer & Verifier Views, Independent QR Image Decoding Verification, and End-to-End Real-Browser Hashing Verification in Google Chrome  
**Status:** Complete & Verified Across Unit, Component, Node/Anvil Integration, and Real-Browser E2E Suites  
**Date:** 2026-10-28  
**Notice:** This deliverable implements client-side cryptographic hashing, zero-auth smart contract reads, local QR code generation, and independent multidimensional verification for local and testnet staging. It has not undergone an independent formal security audit and is not claimed as production-ready.

---

## 1. Summary of Changes & Architecture

### 1.1 Canonical Verification URL Architecture (`frontend/src/lib/certificate/share.ts`)
- **Shared Canonical URL Builder (`buildCanonicalVerificationUrl`):** Centralizes all public verification link generation across the application. Verification URLs strictly adhere to the route schema:
  ```
  ${origin}/verify/${certId.toLowerCase()}?chainId=${chainId}&registry=${checksummedRegistryAddress}
  ```
- **Strict Cryptographic Scoping:** The link is explicitly bound to `(certId, chainId, registryAddress)`. Silently falling back to arbitrary deployments or omitting deployment parameters is strictly forbidden.
- **Strict Application Origin Validation (`validateApplicationOrigin`):**
  - Uses the validated configured application origin (`NEXT_PUBLIC_APP_URL`).
  - Never derives share origins from untrusted HTTP `Host` headers or user-supplied query parameters.
  - Enforces valid `http:` or `https:` protocols and explicitly rejects dangerous schemes (`javascript:`, `data:`, `file:`, `ftp:`), embedded credentials (`user:pass@`), and path segments.
- **Information Hygiene Guarantee:** Verification URLs contain strictly hexadecimal identifiers and deployment coordinates. URLs contain **zero filenames, zero PDF bytes, zero personal identity metadata, zero wallet signatures, and zero session tokens**.
- **Transparent Local-Only Labeling (`isLocalOrigin`, `LOCALHOST_ORIGIN_NOTICE`):**
  - Automatically identifies local development origins (`localhost`, `127.0.0.1`, `[::1]`, `.local`, `.internal`).
  - Surfaces a clear notice explaining that local links are accessible only on the development machine and cannot be opened from external devices or mobile scanners unless an external tunnel (e.g. ngrok) or public origin is configured.
- **URL Parser & Bidirectional Validator (`parseCanonicalVerificationUrl`):** Parses incoming canonical verification links and guarantees that `certId`, `chainId`, and `registryAddress` survive encoding, transportation, and routing.

### 1.2 Share Controls & Local QR Generation (`CertificateShareControls.tsx`, `CertificateShareModal.tsx`)
- **Three Core Share Actions:** Added accessible controls to registered certificates:
  1. **“Copy verification link”:** Copies the canonical URL directly to the system clipboard with an immediate 2-second visual confirmation (`Copied Link!`), accessible `aria-label`, and error fallback.
  2. **“Open verification page”:** Direct external link (`<a target="_blank" rel="noopener noreferrer">`) opening the canonical public verification route in a new tab.
  3. **“Download QR”:** Generates and downloads a high-contrast 512×512 PNG image file directly to the user's filesystem.
- **Unrestricted Sharing for Revoked & Deauthorized Records:**
  - Sharing is unconditionally available for all registered certificates, including revoked credentials and certificates issued by deauthorized wallets.
  - Explains the non-endorsement principle: sharing provides a transparent lookup of on-chain facts and never constitutes an endorsement of current validity.
- **100% Local QR Generation via Maintained Library:**
  - Employs the maintained, audited `qrcode` library to render QR codes purely in browser/Node memory.
  - Zero external QR APIs, zero third-party image endpoints, and zero telemetry.
- **High-Resolution PNG Specifications:**
  - Canvas / PNG resolution: 512×512 pixels.
  - Quiet zone: 4 modules (standard QR spec compliance).
  - Contrast: High-contrast pure black (`#000000`) modules on pure white (`#ffffff`) background.
  - Error correction: Level `M` (standard 15% error recovery).
- **Safe Filename Generation (`getSafeQrFilename`):** Derives safe, deterministic filenames based strictly on the certificate ID (e.g., `certproof-qr-0x1111111111111111.png`). Disallows shell metacharacters, spaces, or directory traversal sequences.
- **Resource Management & DOM Cleanup (`triggerQrDownload`):** Automatically appends temporary download anchor elements, dispatches native download triggers, and removes elements from the DOM immediately within a `finally` block.
- **Explicit Cryptographic & Legal Disclosures:**
  - Explains that the QR code encodes only a live on-chain smart contract lookup URL.
  - Clarifies that the QR code does not contain the PDF file and does not prove validity by itself; verifiers must independently select and compare candidate PDF document bytes.
  - Strictly preserves existing documents: CertProof does not alter, water-mark, or re-encode candidate or registered PDFs.

---

## 2. Real-Browser Verification of Local PDF Comparison

### 2.1 Test Methodology & Automation (`scripts/verify-browser-e2e.mjs`)
To fulfill the Stage 2 mandate for real-browser verification without relying on simulated Node worker handlers, a dedicated Playwright automation runner was implemented to test against real Google Chrome (`Google Chrome 156.0.8078.73` installed at `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`):
1. **Isolated Anvil Instance:** Spawns a dedicated Anvil node on isolated port `8562`.
2. **Contract Deployment:** Deploys `CertProofRegistry` contract and authorizes issuer wallet.
3. **Fixture Anchoring:** Registers the exact Keccak-256 hash of `fixtures/original.pdf` (`0xf98502a9365a9b66aab2d6e1cb5395027ac6820df744fc8013c3065341ad7daf`) under `testCertId = "0x1111111111111111111111111111111111111111111111111111111111111111"`.
4. **Next.js Production Build:** Compiles the optimized production build (`next build`) to ensure Webpack packages `pdf-hash.worker.ts` into a production Web Worker chunk (`new Worker(new URL(...))`).
5. **Production Server Startup (Zero MongoDB):** Launches `next start -p 3005` with `MONGODB_URI` uninitialized to empirically confirm that public verification operates with zero database dependency.
6. **Real Browser Execution:** Opens real headless Google Chrome and navigates to the public verification URL.

### 2.2 Observed Real-Browser Results
All 8 verification stages executed and passed cleanly:

```
===============================================================
CertProof Sprint 4 Stage 2: Real-Browser Public Verification E2E
===============================================================
[1/8] Starting isolated Anvil node on port 8562...
  ✓ Anvil node is active and accepting RPC traffic.
[2/8] Deploying CertProofRegistry and registering test certificate...
  ✓ CertProofRegistry deployed at 0x5fbdb2315678afecb367f032d93f642f64180aa3
  ✓ Issuer 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 authorized.
  ✓ Registered Certificate 0x1111111111111111111111111111111111111111111111111111111111111111 with hash 0xf98502a9365a9b66aab2d6e1cb5395027ac6820df744fc8013c3065341ad7daf
[3/8] Compiling Next.js production build for real Web Worker bundling...
  ✓ Next.js production build succeeded.
[4/8] Starting production server on port 3005 (Zero MongoDB)...
  ✓ Production application server is active.
[5/8] Launching installed Google Chrome instance via Playwright...
  ✓ Google Chrome 156.0.8078.73 launched successfully.
[6/8] Exercising public verification route in real browser...
  Navigating to: http://localhost:3005/verify/0x1111111111111111111111111111111111111111111111111111111111111111?chainId=31337&registry=0x5fbdb2315678afecb367f032d93f642f64180aa3
  ✓ Zero wallet / SIWE prompts rendered on public verification route.
  ✓ Authoritative registration record loaded from contract.
  ✓ Prominently displays "DOCUMENT HAS NOT BEEN COMPARED" before candidate selection.
[7/8] Testing browser Web Worker Keccak-256 local comparison & zero upload...
  -> Selecting fixtures/original.pdf...
  ✓ Web Worker produced: BYTE-FOR-BYTE IDENTICAL
  ✓ Displayed matching digest: 0xf98502a9365a9b66aab2d6e1cb5395027ac6820df744fc8013c3065341ad7daf
  ✓ Zero-upload privacy confirmed: 0 PDF bytes or filenames uploaded to network.
  -> Replacing with fixtures/duplicate.pdf...
  ✓ Web Worker produced: BYTE-FOR-BYTE IDENTICAL for duplicate file.
  -> Replacing with fixtures/modified.pdf (1-byte altered)...
  ✓ Web Worker produced: DOCUMENT HASH MISMATCH for altered file.
  ✓ Displayed altered candidate digest: 0xb738b380d12bfc3dd1c3afd068af6ef821b33aec782a6ee028bd17bc1fff7be7
  -> Clicking "Clear File" button...
  ✓ Comparison state cleanly reset to "DOCUMENT HAS NOT BEEN COMPARED".
  -> Testing rapid file replacement while worker is hashing...
  ✓ Stale worker cancellation verified: obsolete results cannot overwrite active selection.
[8/8] Testing Share controls and QR code generation in real browser...
  ✓ Share & QR modal opened.
  ✓ Real browser rendered local QR code PNG (data URL).
  ✓ Displayed local-only origin notice for localhost application.
  ✓ Modal closed cleanly.
  ✓ 0 browser console errors during entire real-browser session.

===============================================================
SUCCESS: All Real-Browser Verification Checks Passed Cleanly!
===============================================================
[Cleanup] Tearing down test processes...
```

### 2.3 Network Privacy & Zero-Upload Verification
During the real browser execution:
- Every outgoing HTTP request from the page was intercepted via Playwright (`page.on('request')`).
- Inspected request URLs, headers, and request payloads during file selection, reading, and hashing.
- Confirmed that **zero requests contained `%PDF-` byte sequences, PDF fixture filenames (`original.pdf`, `duplicate.pdf`, `modified.pdf`), or binary document data**.
- All outbound traffic was strictly limited to local EVM JSON-RPC queries (`eth_blockNumber`, `eth_getCode`, `eth_call`) and static application JavaScript/worker assets.

---

## 3. Independent QR Code Decoding Verification

To verify that generated QR codes accurately preserve canonical verification parameters, an independent automated verification pipeline was implemented in `frontend/test/certificate-share.test.ts`:
1. **Generation:** Generates 512×512 QR code PNG byte buffer via `qrcode.toBuffer(canonicalUrl)`.
2. **Independent Decoding:** Reads the raw PNG buffer using `pngjs` and decodes the pixel raster via `jsqr` (`jsQR(imageData, width, height)`).
3. **Exact Equality Assertion:**
   ```ts
   expect(decoded.data).toBe(canonicalUrl);
   ```
4. **Parameter Survival Test:** Decoded URL was parsed with `parseCanonicalVerificationUrl` and verified that:
   - `certId` matched the exact 66-character registered identifier.
   - `chainId` matched the expected numeric EVM chain ID (`31337`).
   - `registryAddress` matched the checksummed contract address.
5. **Negative & Adversarial Cases Covered:**
   - Malformed certificate IDs (short, non-hex, all-zero) rejected prior to link construction.
   - Unsupported chain IDs (e.g., chain ID 1 or negative IDs) rejected with explicit errors.
   - Invalid Ethereum registry addresses rejected.
   - Dangerous origins (`javascript:`, `file:`, embedded credentials) rejected.
   - Revoked records and deauthorized issuer credentials generate valid QR codes that preserve their specific on-chain status facts.

---

## 4. Complete Verification Matrix & Test Execution Log

### 4.1 Automated Test Execution Summary
Command: `npm test` (inside `frontend/`)
- **Total Test Suites Executed:** 16 suites (expanded from 14 in Stage 1).
- **Total Tests Passed:** 135 passed (0 failed, 0 skipped).

| Test Suite | Tests | Result | Focus Area |
| :--- | :---: | :---: | :--- |
| `test/certificate-share.test.ts` | 14 | **Passed** | Canonical URL builder, origin validation, local origin detection, independent QR decoding (`jsQR`), safe filenames, DOM download triggers |
| `test/certificate-share-components.test.tsx` | 3 | **Passed** | Issuer table share controls, revoked entry sharing, public verifier share controls, modal rendering |
| `test/certificate-public-components.test.tsx` | 11 | **Passed** | Four independent verification facts, local PDF comparison, zero wallet access, upload prevention |
| `test/certificate-public-anvil.test.ts` | 9 | **Passed** | Direct contract reads against real Anvil node, consistent snapshot, zero MongoDB dependency |
| `test/pdf-worker-fixtures.test.ts` | 4 | **Passed** | Direct Web Worker logic execution with real PDF fixtures |
| `test/session-invalidation.test.tsx` | 18 | **Passed** | Account switching, chain change, wallet disconnect, race condition rejection |
| `test/certificate-revocation-components.test.tsx` | 8 | **Passed** | Revocation dialog, simulation, reason code persistence |
| `test/certificate-components.test.tsx` | 9 | **Passed** | Registration dropzone, pre-read file size limits, duplicate prevention |
| `test/certificate-recovery.test.ts` | 13 | **Passed** | In-flight recovery drafts, replay protection |
| `test/certificate-revocation-anvil.test.ts` | 5 | **Passed** | On-chain revocation rules on real Anvil node |
| `test/certificate-registration-anvil.test.ts` | 8 | **Passed** | Smart contract registration & bounded pagination |
| `test/auth-siwe.test.ts` | 9 | **Passed** | EIP-4361 SIWE nonce, domain, signature verification |
| `test/pdf-hash.test.ts` | 12 | **Passed** | Browser-local Keccak-256 hashing and format heuristics |
| `test/registry-read.test.ts` | 5 | **Passed** | Viem public client contract read helpers |
| `test/session.test.ts` | 6 | **Passed** | Iron-session cryptographic token cookies |
| `test/concurrency.test.ts` | 1 | **Passed** | Atomic nonce redemption concurrency |

### 4.2 Real-Browser Playwright E2E Suite
Command: `node scripts/verify-browser-e2e.mjs` (or `npm run test:browser`)
- **Browser:** Google Chrome 156.0.8078.73 (actual desktop browser binary)
- **Node/Anvil Node:** Port 8562
- **Next.js Production Server:** Port 3005 (zero MongoDB)
- **Status:** **8/8 steps passed cleanly (exit code 0)**.
- **Console Errors:** 0 unhandled console errors.

### 4.3 Static Analysis, Linting & Production Build
- **Type Checking:** `cd frontend && npx tsc --noEmit` → **0 errors**.
- **ESLint:** `cd frontend && npm run lint` → **✔ No ESLint warnings or errors** (`next/core-web-vitals`).
- **Production Next.js Build:** `cd frontend && npm run build` → **Compiled successfully (exit code 0)**.

---

## 5. Dependency Audit Findings & Security Posture

> [!NOTE]
> **Sprint 5 Stage 1 Security Status Update:**
> As of Sprint 5, Stage 1 (October 28, 2026), dependency security findings have been actively remediated. The 38 reported vulnerabilities have been reduced to 2 (1 high, 1 critical, both originating from Next.js 14 / nested PostCSS), 374 unnecessary transitive packages were eliminated by decoupling unused wallet connectors via Wagmi 3 and isolated injected imports, and `vitest`, `glob`, and `zod` advisories were remediated. See [sprint-5-stage-1.md](file:///Volumes/D%20Disc/WEB3/CertProof/docs/sprint-5-stage-1.md) for full remediation evidence. The historical findings below are retained for audit trail integrity.

### 5.1 Audit Evidence Preservation
- **Root Repository (`package.json`):** `npm audit` reports **0 vulnerabilities**.
- **Frontend Project (`frontend/package.json`):** `npm audit` reports **38 vulnerabilities** (17 moderate, 18 high, 3 critical).
- **New Dependency Audit Impact:**
  - Added dependencies: `qrcode` (runtime), `@types/qrcode` (dev), `jsqr` (dev), `@types/pngjs` (dev), `playwright` (dev).
  - Newly added dependencies introduced **0 new vulnerabilities or advisories**. The vulnerability count remained exactly 38.

### 5.2 Carried Forward Upstream Finding Catalog

| Finding / Package | Advisory ID & URL | Severity | Dependency Path | Exposure Type | Runtime Impact in CertProof |
| :--- | :--- | :---: | :--- | :--- | :--- |
| **`decode-uri-component`** | [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | Moderate | `wagmi` → `@wagmi/connectors` → `@walletconnect/ethereum-provider` → `query-string` → `decode-uri-component` | Runtime (transitive) | Idle: App only instantiates Wagmi's `injected()` connector. No WalletConnect relay URLs parsed. |
| **`ws`** | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)<br>[GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | High | `wagmi` → `@wagmi/connectors` → `@walletconnect/universal-provider` → `ws` | Runtime (transitive) | Idle: EVM communication uses strictly HTTP transport (`http(...)`). WebSockets unused. |
| **`zod`** | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | High | `wagmi` → `@wagmi/connectors` → `@coinbase/cdp-sdk` / `@reown/appkit` → `zod` | Runtime (transitive) | Idle: CertProof does not import Coinbase CDP SDK or Reown AppKit. |
| **`uuid`** | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Moderate | `wagmi` → `@wagmi/connectors` → `@metamask/sdk` → `@metamask/utils` → `uuid` | Runtime (transitive) | Idle: MetaMask extension communicates via `window.ethereum`, not Mobile SDK bridge. |
| **`vitest` & `tinypool`** | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)<br>[GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)<br>[GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)<br>[GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) | Critical / High / Moderate | `devDependencies` → `vitest` → `tinypool` / `@vitest/mocker` | Development-only | Offline: Exclusively executed during local CLI developer tests; completely excluded from build bundle. |

### 5.3 Framework Build Warnings (Non-Advisories)
1. **`@metamask/sdk` Optional Module:** Warning regarding `@react-native-async-storage/async-storage` resolution in `@metamask/sdk/dist/browser/es/metamask-sdk.js` when bundled via wagmi connector.
2. **`ox/_esm/tempo/internal/virtualMasterPool.js` Warning:** Critical dependency dynamic expression warning originating from upstream `viem` tempo definitions.

---

## 6. Sprint 4 Completion Status & Honest Acceptance Boundaries

| Feature / Acceptance Check | Implementation Status | Verification Evidence |
| :--- | :---: | :--- |
| **Zero-Auth Public Verification Route** | **Complete** | Automated via Vitest (`test/certificate-public-components.test.tsx`) & Anvil (`test/certificate-public-anvil.test.ts`). |
| **Authoritative Multidimensional Verification Facts** | **Complete** | All 4 independent facts verified without collapsing into false summary badges. |
| **Browser-Local PDF Keccak-256 Hashing** | **Complete** | Real Web Worker execution verified in both Vitest and Google Chrome 156. |
| **Canonical Verification Link Builder** | **Complete** | Automated unit tests in `test/certificate-share.test.ts` (14/14 passed). |
| **Downloadable High-Res QR Code PNG** | **Complete** | Automated component tests & independent `jsQR` decoding round-trip verified. |
| **Real-Browser PDF Comparison in Google Chrome** | **Complete** | `scripts/verify-browser-e2e.mjs` executed in real Google Chrome 156 with zero upload assertions. |
| **Process & Resource Cleanup** | **Complete** | All ephemeral test ports, Anvil instances, Next.js servers, and browser sessions terminated cleanly. |
| **Interactive Multi-Device QR Mobile Scan** | *Pending Physical Hardware* | Automated decoding passes 100%; physical phone camera scan of localhost requires ngrok/public IP setup. |
| **Formal Smart Contract Security Audit** | *Pending Future Epic* | Internal Foundry unit/fuzz/invariant tests pass; external independent third-party audit remains pending. |
| **Production Frontend Framework Migration** | *Pending Future Epic* | Upgrading to `wagmi@3` / `react@19` / `next@15` planned as an independent architectural epic to eliminate transitive connector advisories. |

---

## 7. Resource & Daemon Cleanup Status

All processes initiated during development and verification have been terminated:
- **Anvil Node Instances:** Test instances on ports 8546–8549 and 8562 stopped (0 orphan processes).
- **Next.js Servers:** Production test instance on port 3005 terminated (0 orphan processes).
- **MongoDB:** Ephemeral container torn down; production DB left untouched.
- **Browser Automation:** Headless Google Chrome browser instance closed cleanly.
- **Port Status:** Ports 8545, 8562, 3005, and 27018 are completely clear.
