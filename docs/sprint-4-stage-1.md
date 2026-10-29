# CertProof — Sprint 4, Stage 1: Public Certificate Verification & Browser-Local PDF Comparison

**Sprint Focus:** Public Verification Route (`/verify/[certId]`), Authoritative Smart Contract Reads, Four Independent Verification Facts, Browser-Local PDF Keccak-256 Hashing Engine, Zero-Tamper Client Verification, and Sprint 4 Stage 1 Verification  
**Status:** Complete & Automated Suite Verified (Interactive Manual Browser Verification Pending)  
**Date:** 2026-10-28  
**Notice:** This deliverable implements client-side cryptographic hashing, zero-auth smart contract reads, and independent multidimensional verification for local and testnet staging. It has not undergone an independent formal security audit and is not claimed as production-ready.

---

## 1. Summary of Changes & Architecture

### 1.1 Zero-Auth Public Verification Route (`frontend/src/app/verify/[certId]/page.tsx` & `/verify/page.tsx`)
- **Zero-Authentication Requirement:** The public verification route operates with zero wallet connection, zero SIWE session, zero issuer authorization, and zero dependency on MongoDB availability.
- **Strict Cryptographic Scoping:** Certificate identity is explicitly scoped to `(chainId, registryAddress, certId)`. URL query parameters attempting to specify unsupported chain IDs or registry contracts are rejected immediately (`UNSUPPORTED_DEPLOYMENT`).
- **RPC Injection Protection:** Route and query parameters attempting to supply arbitrary RPC URLs (e.g., `?rpc=...`) are strictly ignored and rejected; all blockchain communication utilizes the client's configured RPC endpoints (`NEXT_PUBLIC_ANVIL_RPC_URL` / `NEXT_PUBLIC_SEPOLIA_RPC_URL`).
- **Format Validation (`isValidCertId`):** Enforces that `certId` is an exact 66-character non-zero hexadecimal string (`bytes32`). Malformed identifiers are flagged with `MALFORMED_ID` without dispatching RPC traffic.
- **Quick-Access Directory & Landing Page:** Implemented `/verify` index and landing page (`/`) quick-access search to enter a 66-character certificate ID with client validation.
- **Layout & Provider Isolation:** Unauthenticated verifiers visiting `/verify/[certId]` receive no wallet connection pop-ups, SIWE signature prompts, or network redirection dialogs.

### 1.2 Authoritative Smart Contract Reads (`frontend/src/lib/certificate/registry.ts`)
- **Direct Consensus Read:** Reads certificate existence, immutable registration fields (`certId`, `documentHash`, `issuer`, `registeredAt`), revocation status (`revoked`, `revokedAt`), and issuer authorization (`isIssuerAuthorized`) directly from `CertProofRegistry.sol`.
- **Consistent Block Snapshot:** Reads are pinned to an authoritative block snapshot (`blockNumber = await client.getBlockNumber()`), ensuring related state queries evaluate the identical blockchain height.
- **Bytecode Deployment Check:** Verifies that contract bytecode exists at `NEXT_PUBLIC_REGISTRY_ADDRESS` on the target chain. If bytecode is missing, returns `MISSING_DEPLOYMENT`.
- **Authoritative Error Distinction:** Distinguishes `MALFORMED_ID`, `UNSUPPORTED_DEPLOYMENT`, `MISSING_DEPLOYMENT`, `RPC_ERROR`, `UNREGISTERED`, and `REGISTERED`.
- **RPC Outage Integrity:** Transport dropouts, node timeouts, and 5xx errors are surfaced as `RPC_ERROR` with a "Retry Connection" action; they are **never** mapped to "unregistered," "not revoked," or "authorized."
- **Zero Indexer / Zero Off-Chain DB:** Requires no subgraphs, indexers, or off-chain certificate databases.

### 1.3 Four Independent Verification Facts (`frontend/src/components/certificate/PublicCertificateVerifier.tsx`)
The verification interface renders four separate, orthogonal states and never collapses them into a single misleading success badge:
1. **Fact 1: Registration Record:** Displays `REGISTERED` or `UNREGISTERED`, showing Certificate ID, Registered Document Hash, Original Issuing Wallet Address, Registration Timestamp, and observed Block Snapshot.
2. **Fact 2: Candidate Document Comparison:**
   - `UNCHECKED_NO_FILE`: Prominently indicates **`DOCUMENT HAS NOT BEEN COMPARED`**. Opening a verification link exposes on-chain registration metadata only and never implies a document was checked.
   - `HASHING`: Displays progress while computing Keccak-256 in browser memory via background Web Worker.
   - `MATCHING`: Renders **`BYTE-FOR-BYTE IDENTICAL`** when candidate digest matches registered hash.
   - `MISMATCHING`: Renders **`DOCUMENT HASH MISMATCH`** and displays candidate and registered hashes side-by-side.
   - `FILE_ERROR`: Renders format heuristic failures or size limit violations.
3. **Fact 3: Certificate Revocation:**
   - `ACTIVE (Not Revoked)` or `PERMANENTLY REVOKED`.
   - When revoked, surfaces the authoritative `revokedAt` block timestamp and warns that the credential was permanently invalidated by the issuing wallet.
4. **Fact 4: Current Issuer Authorization:**
   - `CURRENTLY AUTHORIZED` or `CURRENTLY DEAUTHORIZED`.
   - Explains that issuer authorization reflects current administrative permissions in the contract and does not rewrite historical provenance.
- **Compound State Transparency:** A matching file can belong to a revoked certificate or a deauthorized issuer; all four facts are displayed simultaneously without obscuring critical invalidations.
- **Legal & Cryptographic Boundaries:** Prominently clarifies that a hash match confirms byte-for-byte equality with the registered fingerprint—not academic accreditation, issuer organizational identity, or the truth of document claims.

### 1.4 Browser-Local PDF Comparison & In-Memory Hashing (`frontend/src/lib/pdf/`)
- **Zero Server Upload:** PDF bytes, filenames, and contents remain in browser memory only and are never uploaded, logged, persisted, or sent to analytics.
- **Pre-Read Size Enforcement:** File size is validated before reading into memory; files exceeding 32 MB or empty files (0 bytes) are rejected immediately.
- **Container Heuristics:** Enforces `%PDF-` magic header at offset 0 and `%%EOF` marker in the final 1,024 bytes.
- **Web Worker Offloading:** Offloads raw Keccak-256 computation to a background Web Worker (`pdf-hash.worker.ts`) using transferable ArrayBuffers to prevent main UI thread freezing.
- **Lifecycle & Stale Work Cancellation:**
   - File replacement or navigation instantly aborts in-flight workers via `AbortController` and `worker.terminate()`.
   - Discards stale worker and RPC responses using monotonic request counters (`hashRequestIdRef`, `readRequestIdRef`).
   - "Clear File" action resets comparison state immediately.
- **Execution Neutralization:** Does not execute, render in `iframe`/`embed`, or parse internal JavaScript from selected candidate PDFs.

### 1.5 Accessible Public Controls (`frontend/src/components/common/CopyButton.tsx`)
- Integrated accessible copy controls for Certificate ID, Document Hash, Issuer Address, and Registry Address with 2-second visual feedback (`Copied!`), `aria-label`, and screen reader compatibility.

---

## 2. Startup & Verification Commands

```bash
# 1. Compile smart contracts & verify ABI parity
npm run compile
npm run export-abi
diff -u contracts/abi/CertProofRegistry.ts frontend/src/lib/abi/CertProofRegistry.ts

# 2. Run all frontend test suites (unit, components, Anvil integration, worker parity)
cd frontend
npm test

# 3. Type check & Linting
npx tsc --noEmit
npm run lint

# 4. Production Next.js Build
npm run build
```

---

## 3. Exact Observed Verification Results

### 3.1 Smart Contract Suite (`contracts/`)
- **ABI Parity Verification:** 0 differences between `contracts/abi/CertProofRegistry.ts` and `frontend/src/lib/abi/CertProofRegistry.ts`.
- **Foundry Invariants Preserved:** All contract access controls, composite deduplication, and revocation rules remain unchanged from Sprint 2.

### 3.2 Frontend Test Suites (`frontend/` via Vitest)
All 14 test suites passed (118 tests total, 0 failed, 0 skipped):

1. **Public Component Suite (`test/certificate-public-components.test.tsx` — 11 tests):**
   - Registered certificate with no selected file prominently shows document has not been compared.
   - Original and duplicate PDF fixture matching (`BYTE-FOR-BYTE IDENTICAL`).
   - Single-byte altered PDF fixture mismatch (`DOCUMENT HASH MISMATCH`) with side-by-side hash comparison.
   - Matching file with revoked certificate status (displays both match and permanent revocation).
   - Matching file with deauthorized issuer status (displays both match and deauthorization).
   - Simultaneously revoked and deauthorized compound state rendered distinctly.
   - Unregistered certificate IDs and malformed hex strings handled gracefully.
   - RPC outage and missing deployment distinguished from valid contract states with retry action.
   - File replacement and clearing cleanly aborts in-flight work and resets comparison state.
   - Public access without a connected wallet or SIWE session renders without prompts or modals.
   - Outbound upload guarantee: 0 network requests dispatched during file hashing.

2. **Public Anvil Integration (`test/certificate-public-anvil.test.ts` — 9 tests):**
   - Direct authoritative read of registered certificate from real Anvil node with consistent block snapshot.
   - Unregistered opaque certificate ID detection.
   - Malformed certificate ID pre-RPC rejection.
   - Unsupported deployment detection (wrong chain ID or wrong registry address).
   - Missing contract deployment detection on empty address.
   - On-chain revocation reflection with registration parameter preservation.
   - Simultaneous issuer deauthorization and revocation reflection.
   - Full public verification operates when MongoDB is unavailable (zero database dependency).
   - RPC failure distinction when node is unreachable (dead port).

3. **Web Worker Direct Fixture Execution (`test/pdf-worker-fixtures.test.ts` — 4 tests):**
   - Direct execution of worker message handler with `original.pdf` buffer matching exact Keccak-256 fixture digest.
   - Worker execution with `duplicate.pdf` matching identical digest.
   - Worker execution with `modified.pdf` producing distinct digest matching altered fixture hash.
   - Worker container heuristics rejection of corrupted header.

4. **Existing Regression Suites (11 suites — 94 tests):**
   - `test/session-invalidation.test.tsx` (18 tests passed)
   - `test/certificate-revocation-components.test.tsx` (8 tests passed)
   - `test/certificate-components.test.tsx` (9 tests passed)
   - `test/certificate-recovery.test.ts` (13 tests passed)
   - `test/certificate-revocation-anvil.test.ts` (5 tests passed)
   - `test/certificate-registration-anvil.test.ts` (8 tests passed)
   - `test/auth-siwe.test.ts` (9 tests passed)
   - `test/pdf-hash.test.ts` (12 tests passed)
   - `test/registry-read.test.ts` (5 tests passed)
   - `test/session.test.ts` (6 tests passed)
   - `test/concurrency.test.ts` (1 test passed)

- **Total Frontend Test Count:** 118 passed across 14 test suites.

### 3.3 TypeScript, Linting & Production Build
- `cd frontend && npx tsc --noEmit`: 0 errors.
- `cd frontend && npm run lint`: 0 ESLint warnings or errors (`next/core-web-vitals`).
- `cd frontend && npm run build`: Successfully built all routes including `/`, `/issuer`, `/verify`, and `/verify/[certId]`.

---

## 4. Test Environment & Browser Tooling Transparency

- **Automated Vitest Environment:** Tests run in `happy-dom` and Node.js environments.
- **Browser Web Worker Coverage:** Real worker message handlers and buffer processing were verified with exact fixture files (`original.pdf`, `duplicate.pdf`, `modified.pdf`). In `test/pdf-hash.test.ts`, Web Worker dispatch and termination were verified with mock Worker objects.
- **Interactive Browser Verification Pending:** Neither Playwright nor Puppeteer is installed in this repository; interactive end-to-end browser verification in a live desktop/mobile browser session remains pending manual execution.
- **No Manual Claims:** No manual or browser checks are claimed as passed beyond the automated test suites executed.

---

## 5. Security Blockers & Open Dependency Findings

The following upstream dependency warnings observed during `npm run build` remain explicitly open and unresolved as known public-deployment blockers for future release sprints:
1. **`@metamask/sdk` Optional Storage Warning:** Warning regarding `@react-native-async-storage/async-storage` resolution in `@metamask/sdk/dist/browser/es/metamask-sdk.js` when bundled via wagmi connector.
2. **`ox/_esm/tempo/internal/virtualMasterPool.js` Warning:** Critical dependency dynamic expression warning originating from upstream `viem` tempo definitions.
3. **Smart Contract Formal Audit:** Smart contracts and frontend crypto pipelines have not undergone an external third-party security audit. Real credentials should not be submitted on testnets or mainnets.

---

## 6. Scope Boundaries & Cleanup Status

- **Out of Scope Maintained:** QR code generation, PDF generation, NFTs, new admin controls, database metadata models, visual redesign, and deployment automation were intentionally excluded in Stage 1.
- **No Public Broadcasts:** No transactions were published or broadcasted to any public testnet or mainnet.
- **Process & Daemon Cleanup:** All temporary background tasks, test Anvil instances (ports 8546, 8547, 8548, 8549), Next.js build runners, and isolated MongoDB test containers were terminated.
- **State Preservation:** Existing project manifests, deployment records, fixtures, and database data remain intact and uncorrupted.
