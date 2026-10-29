# CertProof — Sprint 3, Stage 3: Certificate Revocation UI, Contract Integration & Portal Finalization

**Sprint Focus:** Certificate Revocation Confirmation Dialog, Smart Contract Transaction Integration, Independent Revocation Rights for Deauthorized Issuers, Safe Pending Revocation Storage Recovery, Web Worker PDF Hashing Offloading, and Sprint 3 Verification  
**Status:** Complete & Automated Suite Verified (Interactive Manual Verification Pending)  
**Date:** 2026-10-28  
**Notice:** This deliverable implements client-side cryptographic hashing, smart contract registration, paginated discovery, and revocation workflows for local and testnet staging. It has not undergone an independent formal security audit and is not claimed as production-ready.

---

## 1. Summary of Changes & Architecture

### 1.1 Decoupled Revocation Rights & Parent Guards (`frontend/src/app/issuer/page.tsx`)
- **Independent Authorization Dimensions:** Aligned the issuer page with smart contract invariants (`invariant_PermanentRevocation`, `test_OriginalIssuerCanRevokeAfterDeauthorization`).
- **Parent Guard Decoupling:** Reconfigured parent screen rendering so that deauthorization (`isAuthorized === false`) gates only new certificate registration (`CertificateRegistration`).
- **Preserved Certificate History & Revocation:** Deauthorized issuers retain full, unhindered access to their issued certificate history (`IssuerCertificateList`) and can invoke `revokeCertificate` for any active credential originally registered by their wallet.
- **Strict Application Guardrails:** Enforces valid SIWE session, matching connected wallet address, and configured target network (Chain ID 31337 / 11155111) for all portal interactions.
- **Contract Integrity:** Smart contract code was not modified; administrators retain zero unilateral revocation authority.

### 1.2 Revocation Confirmation Dialog (`frontend/src/components/certificate/RevocationDialog.tsx`)
- **Accessible Modal Implementation:** Configured standard accessibility semantics (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`), initial focus management, focus trapping, and `Escape` keyboard dismissal (guarded against active broadcast/confirmation phases).
- **Comprehensive Identity Transparency:** Displays Certificate ID (`certId`), Document Keccak-256 Hash (`documentHash`), Original Issuing Account (`issuer`), Target Network (`chainId`), and Registry Address (`registryAddress`).
- **Educational & Legal Disclosures:**
  - **Permanence Notice:** Highlights that revocation is unidirectional and cannot be undone on the blockchain.
  - **Record Update Boundary:** Explains that revocation flags the on-chain registry entry (`revoked = true`, `revokedAt = block.timestamp`); it does not delete the physical/digital PDF document in the possession of students or verifiers, nor does it purge registration history.
  - **Zero-PDF Requirement:** Clarified that revocation targets the immutable certificate ID and requires no PDF upload or re-selection.
- **Pre-Submission Pre-Flight:** Direct on-chain read of `getCertificate(certId)` followed by `simulateContract({ functionName: 'revokeCertificate' })` before requesting wallet signatures.
- **Parameter Freezing:** Cryptographically freezes `(certId, documentHash, issuer, chainId, registryAddress)` in state before submission.

### 1.3 Contract Execution & Receipt Event Verification (`frontend/src/lib/certificate/registry.ts`)
- **Simulate & Submit:** Simulates `revokeCertificate(certId)` and handles custom errors (`CertProof__CertificateNotFound`, `CertProof__NotCertificateIssuer`, `CertProof__AlreadyRevoked`).
- **Duplicate Broadcast Prevention:** Disables action buttons during in-flight operations and tracks active execution stages.
- **Resilient Exception Handling:** Catches user wallet denial (`4001` / `User rejected`), RPC network dropouts, simulation reversions, and transaction replacement.
- **Receipt & Event Parsing:**
  - Verifies `receipt.status === 'success'`.
  - Parses logs for `event CertificateRevoked(bytes32 indexed certId, address indexed issuer, uint256 revokedAt)`.
  - Enforces that emitting contract equals `NEXT_PUBLIC_REGISTRY_ADDRESS` and args match `(certId, issuer)`.
- **State Reconciliation:** Follows event confirmation with an immediate contract read (`getCertificate(certId)`) to verify `revoked === true` while ensuring original registration fields (`documentHash`, `issuer`, `registeredAt`) remain intact.
- **Authoritative Timestamp:** Surfaces the block-authoritative `revokedAt` timestamp returned by the smart contract.

### 1.4 Safe Pending-Operation Recovery (`frontend/src/lib/certificate/storage.ts`)
- **Operation-Type Scoping:** Extended storage architecture with `PendingRevocationDraft` scoped to `operationType: 'revocation'`, account, chain ID, and contract deployment address.
- **Untrusted Input Validation:** Validates exact 66-character hex strings for IDs/hashes and 42-character hex for addresses. Rejects tampered, corrupt, or out-of-scope entries upon load.
- **Zero Sensitive Data:** Never stores signatures, session tokens, PDF bytes, or filenames in browser storage.
- **Refresh & Timeout Recovery:** Reconstructs pending transaction state after page reload.
- **Uncertain Receipt Protection:** If receipt fetching times out or RPC disconnects, transitions to `unknown_receipt` state and offers a "Check Transaction Status" action without re-broadcasting.
- **Context Invalidation:** Account switches, disconnects, or network changes clear active dialogs and prevent delayed in-flight responses from corrupting context.

### 1.5 Issuer Portal Refresh & Pagination Preservation (`frontend/src/components/certificate/IssuerCertificateList.tsx`)
- **Direct Entry Update:** Immediately updates revoked certificate status in local state and re-queries the contract, preserving the current pagination page index (`currentPage`).
- **Permanent History:** Revoked certificates remain permanently displayed in the bounded table, tagged with `Revoked` badges, registration dates, and revocation timestamps.
- **Decoupled Facts:** Displays registration existence, revocation status, and current authorization status as three independent dimensions.

### 1.6 Web Worker PDF Hashing Responsiveness (`frontend/src/lib/pdf/`)
- **Empirical Profiling:** Measured synchronous Keccak-256 calculation on a synthetic 32 MB buffer near the documented limit, observing ~1.8 seconds of continuous main-thread blocking.
- **Web Worker Offloading (`pdf-hash.worker.ts`):** Offloads raw binary array buffer format heuristics and Keccak-256 hashing to a dedicated background Web Worker when available in browser environments.
- **Memory Transfer Optimization:** Utilizes transferable `ArrayBuffer` objects (`[buffer]`) to prevent memory cloning between threads.
- **Immediate Cancellation:** AbortSignal listener terminates the active worker immediately via `worker.terminate()`, cancelling ongoing computation upon file re-selection or component unmount.
- **Fixture Parity & Fallback:** Retains 100% fixture parity (`original.pdf`, `duplicate.pdf`, `modified.pdf`) and seamlessly falls back to direct execution in Node.js test and SSR runners.

---

## 2. Startup & Development Commands

```bash
# 1. Compile contracts & export ABI
npm run compile
npm run export-abi

# 2. Check ABI parity
diff -u contracts/abi/CertProofRegistry.ts frontend/src/lib/abi/CertProofRegistry.ts

# 3. Run all unit, fuzz, invariant, and frontend tests
npm run test:all

# 4. Production frontend build & linting
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
Unified Vitest run evaluated 94 tests across 11 test suites:

1. **PDF Hashing & Web Worker Parity (`test/pdf-hash.test.ts`):** 12 passed.
   - Exact Keccak-256 matching for `fixtures/original.pdf`, `fixtures/duplicate.pdf`, and `fixtures/modified.pdf`.
   - Single-byte alteration sensitivity verification.
   - Header magic byte (`%PDF-`) and trailer (`%%EOF`) heuristics validation.
   - Early rejection of empty files (0 bytes) and oversized files (>32 MB) prior to buffer reading.
   - AbortSignal cancellation verification for rapid file replacement.
   - Zero network activity verification (0 fetch calls).
   - Web Worker dispatch, buffer transfer, and immediate worker termination on AbortSignal.

2. **Safe Pending-Operation Recovery (`test/certificate-recovery.test.ts`):** 13 passed.
   - Valid storage and retrieval within identical scope for registration and revocation drafts.
   - Account isolation: Account B cannot restore Account A pending registration or revocation operations.
   - Chain ID and registry contract address isolation.
   - Rejection of corrupt, tampered, or mismatched operation types in `sessionStorage`.
   - Absence of filenames, PDF bytes, signatures, or session tokens.
   - Idempotent update of broadcasted `txHash` and draft clearing.

3. **Local-Anvil Integration: Registration & Pagination (`test/certificate-registration-anvil.test.ts`):** 8 passed.
   - Generation of non-zero opaque 32-byte certificate IDs.
   - Authorized issuer simulation and registration on local Anvil.
   - Unauthorized stranger rejection (contract revert).
   - Duplicate registration rejection of identical document hash by same issuer.
   - Global Certificate ID collision rejection.
   - Independent registration of identical document hash by distinct authorized issuers.
   - Permanent duplicate prevention active even after certificate revocation.
   - Bounded pagination retrieval, chronological slice ordering, and inclusion of revoked certificates.

4. **Local-Anvil Integration: Revocation & Authorization Decoupling (`test/certificate-revocation-anvil.test.ts`):** 5 passed.
   - Original issuer revocation with receipt event parsing and direct state reconciliation.
   - Revocation access retention after administrator deauthorization (`isIssuerAuthorized == false`).
   - Rejection of unauthorized stranger and administrator revocation attempts.
   - Rejection of non-existent certificates and repeated revocation calls.
   - Preservation of original registration parameters and presence in paginated issuer list.

5. **Component State & Revocation Dialog (`test/certificate-revocation-components.test.tsx`):** 8 passed.
   - Dialog rendering with identity parameters, network, registry address, and educational notices.
   - Keyboard accessibility (`Escape` key modal dismissal).
   - User wallet rejection handling without loss of frozen parameters.
   - Uncertain receipt timeout state forbidding duplicate submissions with "Check Transaction Status".
   - Full receipt verification and state reconciliation updating authoritative `revokedAt`.
   - Revoke action enabled strictly for active certificates owned by the connected wallet.
   - Refresh recovery of pending revocation from `sessionStorage`.
   - Deauthorized issuer page access preserving certificate history and revocation while hiding registration.

6. **Component State: Registration & Dropzone (`test/certificate-components.test.tsx`):** 9 passed.
7. **Wallet & Session State Invalidation (`test/session-invalidation.test.tsx`):** 18 passed.
8. **SIWE & Challenge Verification (`test/auth-siwe.test.ts`):** 9 passed.
9. **Session Management & Indexes (`test/session.test.ts`):** 6 passed.
10. **Registry Authorization Reads (`test/registry-read.test.ts`):** 5 passed.
11. **Atomic Concurrency (`test/concurrency.test.ts`):** 1 passed.

- **Total Frontend Tests:** 94 passed across 11 suites, 0 failed, 0 skipped.
- **Combined Test Count:** 132 passed across all contract and frontend layers.

### 3.3 TypeScript, Linting & Production Build
- `cd frontend && npx tsc --noEmit`: 0 errors.
- `cd frontend && npm run lint`: 0 ESLint warnings or errors (`next/core-web-vitals`).
- `cd frontend && npm run build`: Production build succeeded. All 8 routes and static/dynamic handlers compiled and optimized.
- `diff -u contracts/abi/CertProofRegistry.ts frontend/src/lib/abi/CertProofRegistry.ts`: 0 diff (100% ABI parity).

---

## 4. Pending Checks & Boundaries

| Area | Automated Verification (Complete) | Pending Interactive Manual Verification |
| :--- | :--- | :--- |
| **PDF Hashing** | Verified against byte-exact fixtures (`original.pdf`, `duplicate.pdf`, `modified.pdf`) and Web Worker termination. | **Pending:** Native OS drag-and-drop file picker interaction across diverse browsers (Safari, Firefox, Chromium). |
| **Transaction Signing** | Verified on Anvil via Viem wallet clients and mocked wallet hooks. | **Pending:** Real MetaMask / browser extension popup signing (`eth_sendTransaction`). |
| **Transaction Replacement** | Tested simulation failure, user rejection, and timeout states. | **Pending:** Interactive MetaMask speed-up / gas-boost replacement testnet edge case. |
| **Revocation Modal** | Tested modal rendering, focus trap, Escape key handling, and receipt reconciliation. | **Pending:** Manual keyboard navigation tab-order walkthrough in desktop browser. |

---

## 5. Carried-Forward Dependency Security Findings (Public-Deployment Blockers)

> [!NOTE]
> **Sprint 5 Stage 1 Security Status Update:**
> As of Sprint 5, Stage 1 (October 28, 2026), dependency security findings have been actively remediated. Unused wallet connectors (`@walletconnect/*`, `@metamask/sdk`, `@coinbase/*`, `@reown/*`, `ws`, `axios`) were completely decoupled and eliminated from both the resolved tree and production bundle via Wagmi 3. Audit findings dropped from 38 down to 2 (originating from Next.js 14 / nested PostCSS). See [sprint-5-stage-1.md](file:///Volumes/D%20Disc/WEB3/CertProof/docs/sprint-5-stage-1.md) for full details. The historical table below is preserved for historical audit record.

As identified in Sprint 3, Stage 1 verification, the frontend dependency tree contains known upstream security advisories from transitive Web3 wallet connectors:
- **Root Package Tree:** 0 vulnerabilities (`npm audit` clean).
- **Frontend Package Tree:** 38 vulnerabilities (17 moderate, 18 high, 3 critical) originating exclusively from transitive sub-dependencies of `@wagmi/connectors` (`@metamask/sdk`, `@walletconnect/ethereum-provider`, `axios`).

| Finding / Package | Advisory ID & URL | Installed Version | Affected Range | Dependency Path | Exposure Type | Application Evidence | Fixed Version / Remediation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **axios** (Critical) | [GHSA-c2qf-rxjj-qqgw](https://github.com/advisories/GHSA-c2qf-rxjj-qqgw) | 1.7.4 | `< 1.7.5` | `@metamask/sdk` → `axios` | Runtime (Transitive) | Not called by CertProof application code. | Upgrade `@metamask/sdk` once patched upstream. |
| **axios** (High) | [GHSA-76c7-3c52-wmgf](https://github.com/advisories/GHSA-76c7-3c52-wmgf) | 1.7.4 | `< 1.7.8` | `@metamask/sdk` → `axios` | Runtime (Transitive) | SSRF vector not triggered by injected wallet calls. | Upgrade `@metamask/sdk` once patched upstream. |
| **ws** (High) | [GHSA-9j96-v5pr-4w9g](https://github.com/advisories/GHSA-9j96-v5pr-4w9g) | 8.17.1 | `>= 8.0.0 < 8.18.1` | `@walletconnect/ethereum-provider` → `ws` | Runtime (Transitive) | Unused WebSocket server/client pathways. | Custom Wagmi injected connector decoupling. |
| **elliptic** (High) | [GHSA-4859-4vgv-m943](https://github.com/advisories/GHSA-4859-4vgv-m943) | 6.5.7 | `< 6.6.0` | `@walletconnect/ethereum-provider` → `elliptic` | Runtime (Transitive) | Cryptographic signature verification delegated to Viem. | Custom Wagmi connector decoupling. |
| **micromatch** (Moderate) | [GHSA-2c5c-75hx-59hh](https://github.com/advisories/GHSA-2c5c-75hx-59hh) | 4.0.8 | `< 4.0.8` | `next` / `eslint` → `micromatch` | Build / Tooling | Development / build-time only. | Patched upstream in Next.js 14 minor patches. |

> [!IMPORTANT]
> **Public-Deployment Blocker:** These dependency findings remain unresolved public-deployment blockers. They were not resolved in Stage 3 and must be addressed prior to any public production deployment via connector bundle tree-shaking or an isolated framework migration epic.

---

## 6. Sprint 3 Completion Status

With Stage 3 complete, **Sprint 3: Issuer Authentication, PDF Hashing, Certificate Registration & Revocation Portal** is fully implemented and automated-suite verified across all three stages:
- **Stage 1:** Next.js App Router, SIWE authentication, session tokens, and protected issuer portal guards.
- **Stage 2:** Browser-local zero-upload PDF hashing (Keccak-256), on-chain registration, event log decoding, safe draft recovery, and bounded pagination.
- **Stage 3:** Certificate revocation confirmation dialog, transaction simulation and execution, deauthorized issuer access preservation, Web Worker hashing offloading, and pending revocation recovery.

**Deferred to Sprint 4 & Beyond (Out of Scope for Sprint 3):**
- Public verification pages (`/verify`).
- QR code generator and verification scanner.
- External indexer or database caching layer.
- Visual redesign or CSS framework replacements.
- Public network deployment and transaction broadcasting.

---

## 7. Process & Resource Cleanup

- All ephemeral test Anvil instances (ports 8546, 8547, 8548) cleanly terminated.
- Test MongoDB container (`certproof-test-mongo` on port 27018) stopped and removed by global Vitest teardown.
- No background dev servers (Next.js, Anvil) left running.
- Persistent deployments (`deployments/local-anvil.json`), test fixtures (`fixtures/`), and contracts preserved intact.
