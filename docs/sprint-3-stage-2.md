# CertProof — Sprint 3, Stage 2: Browser-Local PDF Hashing, Certificate Registration & Paginated Issuer List

**Sprint Focus:** Client-Side Zero-Upload PDF Ingestion & Keccak-256 Hashing, Smart Contract Registration Flow with Event Parsing, Safe Session-Storage Recovery, and Bounded On-Chain Issuer Certificate Pagination  
**Status:** Complete & Automated Suite Verified (Interactive Manual Verification Pending)  
**Date:** 2026-10-28  
**Notice:** This deliverable implements client-side cryptographic hashing, contract registration, and pagination for local and testnet staging. It has not undergone an independent formal security audit and is not claimed as production-ready.

---

## 1. Summary of Changes & Architecture

### 1.1 Browser-Local PDF Ingestion & Keccak-256 Processing (`frontend/src/lib/pdf/hash.ts`)
- **Pre-Read File Size Guard:** Strictly validates `file.size <= 32 * 1024 * 1024` (33,554,432 bytes) and `file.size > 0` before initiating binary buffer reads into browser memory.
- **Container Format Heuristics:**
  - Header Magic Bytes: Verifies standard `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`) at byte offset 0.
  - Trailer End-of-File Marker: Confirms `%%EOF` (`0x25 0x25 0x45 0x4F 0x46`) exists within the final 1,024 bytes.
  - Format Limitation Disclaimer: Clarified in code and UI that these heuristics are container format checks, not a full structural PDF syntax parser or malware/exploit evaluation.
- **Zero-Tamper Binary Ingestion:** Raw binary bytes are processed directly via `keccak256(new Uint8Array(arrayBuffer))` using Viem. Files are never text-extracted, normalized, compressed, re-serialized, or modified.
- **Zero-Upload Privacy Boundary:** PDF bytes, filenames, and contents remain in transient browser memory only. No bytes or document contents are ever transmitted to any backend API route, database, analytics tracker, or blockchain storage.
- **Lifecycle & Stale Cancellation:** In-flight hashing accepts an `AbortSignal` and tracks monotonically increasing request IDs. Rapid file selection cancels previous hashing tasks and discards stale digests immediately.

### 1.2 On-Chain Certificate Registration (`frontend/src/lib/certificate/registry.ts`, `frontend/src/components/certificate/CertificateRegistration.tsx`)
- **Access Guard:** Requires a valid server-side SIWE session, matching connected wallet address, target network configuration (Chain ID 31337 / 11155111), and active on-chain issuer authorization (`isIssuerAuthorized == true`).
- **Cryptographic Identifier Generation:** Derives opaque 256-bit identifiers (`bytes32 certId`) using `crypto.getRandomValues()`. Enforces non-zero values.
- **Smart Contract Pre-Flight Simulation:**
  - Pre-checks `certificateExists(certId)` on-chain.
  - Simulates `registerCertificate(certId, documentHash)` to enforce contract duplicate rules prior to prompting user wallet transactions.
  - Catches `CertProof__AlreadyRegistered` and prevents duplicate submissions while treating the smart contract as the ultimate authority.
- **Metadata Freezing:** Freezes Certificate ID, Document Hash, Issuing Account, Chain ID, and Registry Address in UI before wallet prompt.
- **Direct Wallet Broadcast:** Invokes `registerCertificate(certId, documentHash)` directly via Wagmi/Viem connected wallet. Never routes transactions through an API server or server-held private key.
- **Receipt & Event Log Verification:**
  - Evaluates `receipt.status === 'success'`.
  - Parses logs for `CertificateRegistered` event.
  - Validates that emitting contract equals `NEXT_PUBLIC_REGISTRY_ADDRESS`.
  - Confirms exact `(certId, issuer, documentHash)` match before committing confirmation state. Does not derive IDs from global counters or unrelated events.
- **Uncertain Receipt State Protection:** If receipt fetching times out or experiences RPC network errors, the application preserves transaction details, flags status as `unknown_receipt`, provides a "Check Existing Transaction Status" action, and prevents duplicate registration broadcasts.

### 1.3 Safe Pending-Operation Recovery (`frontend/src/lib/certificate/storage.ts`)
- **Minimal Non-Sensitive Storage:** Only records non-sensitive recovery metadata in `sessionStorage` (`certId`, `documentHash`, `issuerAddress`, `chainId`, `registryAddress`, `stage`, `txHash`, `timestamp`).
- **Zero Sensitive Data:** Never writes PDF bytes, filenames, signatures, or session tokens to browser storage.
- **Untrusted Data Validation & Scoping:**
  - Validates 66-character hex format for IDs/hashes and 42-character hex for addresses.
  - Scopes recovery to the active wallet address, chain ID, and registry contract. Discards out-of-scope or cross-account data immediately upon inspection.
- **Pre-Broadcast Draft Reselection Requirement:** If a draft without a broadcasted transaction is restored upon page refresh, the UI prompts the issuer to re-select the original PDF file, verifies that the newly calculated hash matches the draft, and only unlocks broadcast upon match.

### 1.4 Paginated Issuer Certificate List (`frontend/src/components/certificate/IssuerCertificateList.tsx`)
- **Bounded Contract Reads:** Directly queries `getIssuerCertificates(address, offset, limit)` from `CertProofRegistry.sol` using standard bounded slices (page size 10, contract maximum 50).
- **Independent Status Dimensions:** Renders separate, orthogonal facts:
  1. Registration Existence (Record timestamp & block provenance).
  2. Revocation Fact (`Active` vs. `Revoked` with timestamp). Revoked certificates remain in history and are visibly listed.
  3. Current Issuer Authorization (`Authorized` vs. `De-authorized`).
- **Account & Chain Isolation:** Resets list and page cursor immediately upon account switch, disconnect, or chain change. Discards delayed in-flight RPC responses to prevent cross-account display leaks.
- **Zero Indexer Architecture:** No off-chain certificate database or third-party indexers. All reads originate directly from the registry smart contract.

---

## 2. Startup & Development Commands

```bash
# 1. Compile contracts & export ABI
npm run compile
npm run export-abi

# 2. Run all unit, fuzz, invariant, and frontend tests
npm run test:all

# 3. Production frontend build & linting
cd frontend
npm run lint
npm run build
```

---

## 3. Exact Observed Verification Results

### 3.1 Smart Contract Test Suite (`contracts/` via Forge)
- **Unit Tests (`test/CertProofRegistry.t.sol`):** 33 passed (0 failed, 0 skipped).
- **Fuzz Tests (`test/CertProofRegistryFuzz.t.sol`):** 4 passed (256 runs per test).
- **Stateful Invariant Campaign (`test/CertProofRegistryInvariant.t.sol`):** 1 campaign passed (evaluating 6 invariant properties over 64 runs and 2,048 handler calls, 0 reverts, 0 discards).
- **Contract Tests Total:** 38 passed, 0 failed, 0 skipped.

### 3.2 Frontend Test Suites (`frontend/` via Vitest)
Unified Vitest run evaluated 74 tests across 9 test suites:

1. **PDF Hashing & Format Heuristics (`test/pdf-hash.test.ts`):** 10 passed.
   - Exact Keccak-256 matching for `fixtures/original.pdf`, `fixtures/duplicate.pdf`, and `fixtures/modified.pdf`.
   - Single-byte alteration sensitivity verification.
   - Header magic byte (`%PDF-`) and trailer (`%%EOF`) heuristics validation.
   - Early rejection of empty files (0 bytes) and oversized files (>32 MB) prior to buffer reading.
   - AbortSignal cancellation verification for rapid file replacement.
   - Zero network activity verification (0 fetch calls).

2. **Safe Pending-Operation Recovery (`test/certificate-recovery.test.ts`):** 8 passed.
   - Valid storage and retrieval within identical scope.
   - Account isolation: Account B cannot restore Account A pending operations.
   - Chain ID and registry contract address isolation.
   - Rejection of corrupt or tampered storage data.
   - Absence of filenames, PDF bytes, signatures, or session tokens in `sessionStorage`.
   - Idempotent update of broadcasted `txHash` and draft clearing.

3. **Certificate Registration & Bounded Pagination on Anvil (`test/certificate-registration-anvil.test.ts`):** 8 passed.
   - Generation of non-zero opaque 32-byte certificate IDs.
   - Authorized issuer simulation and registration on local Anvil.
   - Unauthorized stranger rejection (contract revert).
   - Duplicate registration rejection of identical document hash by same issuer.
   - Global Certificate ID collision rejection.
   - Independent registration of identical document hash by distinct authorized issuers.
   - Permanent duplicate prevention active even after certificate revocation.
   - Bounded pagination retrieval, chronological slice ordering, and inclusion of revoked certificates.

4. **Component State & Wallet Rejection (`test/certificate-components.test.tsx`):** 9 passed.
   - Initial dropzone rendering with container format, zero-upload, and legal boundary disclosures.
   - Pre-read empty file and 32 MB size rejection.
   - Pre-broadcast draft detection requiring PDF re-selection.
   - Wallet rejection handling preserving frozen parameters.
   - Uncertain receipt timeout state forbidding duplicate submissions.
   - Bounded certificate list rendering independent facts (Active vs. Revoked, Authorized vs. De-authorized).
   - Immediate list clearing on account switch.

5. **Wallet & Session State Invalidation (`test/session-invalidation.test.tsx`):** 18 passed.
6. **SIWE & Challenge Verification (`test/auth-siwe.test.ts`):** 9 passed.
7. **Session Management & Indexes (`test/session.test.ts`):** 6 passed.
8. **Registry Authorization Reads (`test/registry-read.test.ts`):** 5 passed.
9. **Atomic Concurrency (`test/concurrency.test.ts`):** 1 passed.

- **Total Frontend Tests:** 74 passed across 9 suites, 0 failed, 0 skipped.
- **Combined Test Count:** 112 passed across all layers.

### 3.3 TypeScript & Production Build
- `cd frontend && npx tsc --noEmit`: 0 errors.
- `cd frontend && npm run lint`: 0 ESLint warnings or errors (`next/core-web-vitals`).
- `cd frontend && npm run build`: Production build succeeded. All 8 routes and static/dynamic handlers compiled and optimized.

---

## 4. Pending Checks & Boundaries

| Area | Automated Verification (Complete) | Pending Interactive Manual Verification |
| :--- | :--- | :--- |
| **PDF Hashing** | Verified against byte-exact fixtures (`original.pdf`, `duplicate.pdf`, `modified.pdf`). | **Pending:** Native OS drag-and-drop file picker interaction across diverse browsers (Safari, Firefox, Chromium). |
| **Transaction Signing** | Verified on Anvil via Viem wallet clients and mocked wallet hooks. | **Pending:** Real MetaMask / browser extension popup signing (`eth_sendTransaction`). |
| **Transaction Replacement** | Tested simulation failure, user rejection, and timeout states. | **Pending:** Interactive MetaMask speed-up / gas-boost replacement testnet edge case. |

---

## 5. Process & Resource Cleanup

- All ephemeral test Anvil instances (ports 8546, 8547) terminated.
- Test MongoDB container (`certproof-test-mongo`) stopped and removed.
- Unrelated Docker containers, host databases, and processes left untouched.
- Persistent deployments (`deployments/local-anvil.json`) and test fixtures preserved.