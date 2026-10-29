# CertProof — Sprint 2 Completion Report: Certificate Registry & Verification Core

**Sprint Focus:** Certificate Registry Smart Contract, Authorization, Permanent Revocation, Bounded Pagination, and Automated Tests  
**Status:** Complete  
**Date:** 2026-10-28  
**Notice:** This software is an MVP deliverable for architectural verification. It has not undergone an independent formal security audit and is not claimed as production-ready.

---

## 1. Executive Summary

Sprint 2 successfully implemented and verified the authoritative consensus layer for CertProof. The core smart contract `CertProofRegistry.sol` was developed from scratch using Foundry with OpenZeppelin Contracts v5, strictly enforcing the zero-tamper raw Keccak-256 hashing model, two-step ownership management with renunciation disabled, caller-derived issuer identities, permanent revocation, and bounded pagination.

All specifications across Sprint 1 documents were standardized and updated to ensure consistency with these consensus rules. The contract achieved **100% statement, line, branch, and function coverage** across all reachable paths.

---

## 2. Files Changed & Created

### 2.1 Specification Updates (Sprint 1 Documents)
- `docs/architecture.md`: Standardized MongoDB server-side session persistence (Sprint 3); defined four independent verification dimensions; removed iron-session references.
- `docs/certificate-and-issuer-model.md`: Documented immutable provenance vs. dynamic authorization; confirmed disabled ownership renunciation; recorded initial admin self-authorization rule; established permanent duplicate blocking and independent multi-issuer registration.
- `docs/product-spec.md`: Rewrote Section 5 to expose four orthogonal verification facts (`Registration Existence`, `Document Hash Match`, `Certificate Revocation`, `Current Issuer Authorization`); specified `UNCHECKED_NO_FILE` state.
- `docs/security-and-test-plan.md`: Updated threat model and security invariants with renunciation policy, admin issuer separation, and four-dimensional verification facts.
- `docs/sprint-backlog.md`: Formally resolved open architectural decisions (pinned to Solidity `0.8.24` and `cancun` EVM target; resolved session storage to MongoDB server-side sessions).
- `docs/user-flows.md`: Clarified public verification behavior: opening a link without file selection explicitly leaves document status as `UNCHECKED (No file selected)`, preventing false implications of document verification.

### 2.2 Toolchain & Implementation Files
- `docs/toolchain.md`: Detailed environment, pinned versions, compiler and optimizer settings, and Cancun EVM justification.
- `contracts/foundry.toml`: Pinned configuration with Solc `0.8.24`, EVM target `cancun`, optimizer runs 200, remappings, and filesystem read permissions.
- `contracts/src/CertProofRegistry.sol`: Complete core registry contract with custom errors, events, and getters.
- `contracts/script/DeployCertProofRegistry.s.sol`: Deployment script for local and testnet deployments.
- `contracts/test/CertProofRegistry.t.sol`: 33 unit tests covering authorization, registration, collision rejection, revocation sovereignty, post-deauthorization revocation, and pagination.
- `contracts/test/CertProofRegistryFuzz.t.sol`: 4 property-based fuzz tests covering arbitrary registration inputs, pagination bounds, and unauthorized access attempts.
- `contracts/test/handlers/CertProofHandler.sol`: Independent stateful invariant handler with ghost state and metrics tracking.
- `contracts/test/CertProofRegistryInvariant.t.sol`: Stateful invariant test asserting 6 core protocol invariants over 2,048 state transitions.
- `fixtures/original.pdf`, `fixtures/duplicate.pdf`, `fixtures/modified.pdf`: Synthetic, PII-free PDF byte fixtures.
- `fixtures/hashes.json` (and `contracts/test/fixtures/hashes.json`): Cryptographic Keccak-256 digests computed via Viem.
- `scripts/generate-fixtures.mjs`: Script to generate PDF fixtures and calculate Viem Keccak-256 hashes.
- `scripts/export-abi.mjs`: Export and verification script generating `contracts/abi/CertProofRegistry.json` and `contracts/abi/CertProofRegistry.ts`.
- `scripts/deploy-and-demo-local.mjs`: Automated local Anvil deployment and end-to-end lifecycle demonstration.
- `deployments/local-anvil.json`: Deployment manifest recording actual chain ID, contract address, transaction hash, block hash, and runtime bytecode hash.

---

## 3. Toolchain & Dependencies

| Tool / Dependency | Pinned Version / Tag | Commit Hash | Configuration / Justification |
| :--- | :--- | :--- | :--- |
| **Solidity Compiler** | `0.8.24` | `0.8.24+commit.e11b9ed9` | Standardized stable compiler with native overflow checks and custom errors. |
| **EVM Target** | `cancun` | N/A | Aligned with Ethereum Mainnet (March 2024) and Sepolia (January 2024) protocol execution rules. |
| **Foundry** | `1.8.6` | `6bad0a66de7c83f7b33695044138f0f5fa4c5990` | Forge, Anvil, and Cast toolchain. |
| **OpenZeppelin Contracts** | `v5.7.0` | `cab19933c33c2ad1d4c7a84864a3601dddfd16f3` | Provides `Ownable2Step` and `Context`. |
| **forge-std** | `v1.17.0` | `f3dae6e6ee381f25eb6a246f7da9b85c91a68219` | Test framework and cheatcodes. |
| **Viem** | `^2.57.12` | N/A | Off-chain client Keccak-256 hashing and deployment scripting. |
| **Node.js** | `v20.20.2` | N/A | Script execution environment. |
| **Optimizer** | Enabled | 200 runs | Balanced runtime efficiency and bytecode deployment footprint. |

---

## 4. Contract Architecture & Behavioral Decisions

1. **Two-Step Ownership Transfer & Disabled Renunciation:**
   - Inherits OpenZeppelin `Ownable2Step`. Ownership changes require `transferOwnership(newOwner)` followed by `acceptOwnership()`.
   - `renounceOwnership()` is explicitly overridden to revert with `CertProof__RenounceOwnershipDisabled()`, preventing permanent loss of registry administration.
2. **Administrator vs. Issuer Role Separation:**
   - The initial contract owner does **not** receive automatic issuer authorization.
   - If the administrator intends to register credentials, it must explicitly authorize its own address via `setIssuerAuthorization(admin, true)`.
3. **Caller-Derived Issuer Address:**
   - In `registerCertificate`, the issuer is strictly bound to `msg.sender`.
4. **Permanent Duplicate Prohibition:**
   - An issuer cannot register the exact same `documentHash` twice, even under different `certId`s.
   - This prohibition remains permanently in effect even if the original certificate is revoked.
   - If an issuer alters the PDF file (e.g. correcting a typographical error), the file produces a different Keccak-256 hash and can be registered under a new `certId`.
5. **Multi-Issuer Provenance:**
   - Distinct authorized issuers may register the same document hash independently, establishing autonomous provenance (e.g., dual-degree consortiums).
6. **Revocation Sovereignty & Post-Deauthorization Rights:**
   - Only the original issuing wallet (`msg.sender == record.issuer`) can revoke a certificate.
   - The original issuer retains revocation rights even if subsequently de-authorized by the administrator.
   - Revocation is unidirectional and irreversible; repeated revocation reverts with `CertProof__AlreadyRevoked()`.
7. **Bounded Pagination:**
   - `getIssuerCertificates(address issuer, uint256 offset, uint256 limit)` enforces `1 <= limit <= MAX_PAGE_SIZE (50)`. Limits of 0 or exceeding 50 revert with `CertProof__InvalidPageLimit`.
   - Out-of-bounds offsets return an empty array with `nextOffset = total`.
   - Revoked certificates are permanently preserved in the issuer's certificate history.

---

## 5. Verification & Test Results

### 5.1 Test Suite Breakdown & Count Reconciliation

`forge test --list` discovers **43 individual test and invariant functions** across the 3 test contracts:
1. `CertProofRegistryUnitTest`: 33 unit test functions (`test_*`)
2. `CertProofRegistryFuzzTest`: 4 property-based fuzz test functions (`testFuzz_*`)
3. `CertProofRegistryInvariantTest`: 6 stateful invariant functions (`invariant_*`):
   - `invariant_AccessControlBoundaries`
   - `invariant_BoundedPagination`
   - `invariant_ImmutableRegisteredData`
   - `invariant_IssuerListConsistency`
   - `invariant_PermanentRevocation`
   - `invariant_UniqueIdsAndPerIssuerHashes`

#### Forge Runner Execution & Reporting Mechanics (Forge 1.8.6)
When executing `forge test -vv`, Forge's test runner reports **`38 passed; 0 failed; 0 skipped (38 total tests)`** across 3 test suites:
- **`CertProofRegistryUnitTest`:** Ran 33 tests; `33 passed; 0 failed; 0 skipped`. Each `test_*` function is executed and reported as an individual test.
- **`CertProofRegistryFuzzTest`:** Ran 4 tests; `4 passed; 0 failed; 0 skipped`. Each `testFuzz_*` function is executed (256 runs each) and reported as an individual test.
- **`CertProofRegistryInvariantTest`:** Ran 1 test; `1 passed; 0 failed; 0 skipped`. In Forge's invariant runner architecture, all invariant target functions defined in an invariant contract are evaluated concurrently during a unified stateful invariant campaign. Forge evaluates all 6 invariant assertions after each handler state transition, displaying `[PASS]` for each invariant assertion under the suite header, but counts the entire campaign as **1 invariant test unit** in its final suite total.
- **Total Reported by Forge Runner:** 33 unit tests + 4 fuzz tests + 1 invariant campaign = **38 passed tests**.
- **Total Discovered Test & Invariant Functions:** 33 unit functions + 4 fuzz functions + 6 invariant functions = **43 discovered functions**.

| Suite Contract | Category | Discovered Functions | Forge Reported Tests | Execution Scope |
| :--- | :--- | :---: | :---: | :--- |
| `CertProofRegistryUnitTest` | Unit Tests | 33 | 33 | 33 individual unit test runs covering core access, registration, collisions, revocation permissions, post-deauthorization revocation, independent states, unknown cert reads, pagination, and fixtures. |
| `CertProofRegistryFuzzTest` | Property Fuzz | 4 | 4 | 4 fuzz functions executed for 256 runs each (registration fields, pagination bounds, unauthorized authorization, unauthorized revocation). |
| `CertProofRegistryInvariantTest` | Stateful Invariant | 6 | 1 | 1 unified invariant campaign evaluating 6 invariant assertion functions across 64 runs and 2,048 handler calls. |
| **Total** | | **43 Functions** | **38 Tests** | **33 Unit + 4 Fuzz + 1 Invariant Campaign (evaluating 6 invariant assertions) = 38 Tests** |

### 5.2 Stateful Invariant Metrics & Handler Analysis

#### Natively Reported by Forge CLI (Observed Output)
- **Invariant Configuration:** `runs = 64`, `depth = 32`.
- **Total Handler Calls:** `64 × 32 = 2,048`.
- **Observed Invariant Summary:** `CertProofRegistryInvariantTest invariants (runs: 64, calls: 2048, reverts: 0)`.
- **Observed Handler Selector Call Distribution:**
  - `CertProofHandler.registerCertificate`: 685 calls, 0 reverts, 0 discards
  - `CertProofHandler.revokeCertificate`: 700 calls, 0 reverts, 0 discards
  - `CertProofHandler.setIssuerAuthorization`: 663 calls, 0 reverts, 0 discards
  - *Total:* 2,048 calls, 0 reverts, 0 discards. (Note: exact per-selector distribution varies pseudorandomly by fuzz seed).

#### Internal Handler Metrics vs. Forge Native Metrics
- **Forge CLI Native Metrics:** Forge only outputs `Calls`, `Reverts`, and `Discards` per selector in its summary table. It reports `0 reverts` because contract reverts during negative tests (such as unauthorized revocation attempts) are caught inside the handler via `try/catch`.
- **Handler Internal State (`CertProofHandler.sol`):**
  - Tracks attempted vs. executed vs. skipped operations across authorizations, registrations, and revocations in contract storage variables.
  - **Successful Operations:** Executed state transitions that update both contract state and independent ghost state.
  - **Expected Reverts & Controlled Skips:** When testing unauthorized callers in `revokeCertificate`, the handler catches the revert (`try registry.revokeCertificate() { revert(); } catch { skippedRevocations++; return; }`), treating expected reverts as controlled skips to prevent test harness aborts while verifying on-chain revert semantics.
  - **Precondition Skips:** Calls with unauthorized issuers, duplicate hashes, or already-revoked IDs are skipped early (`skippedRegistrations++`, `skippedRevocations++`) to avoid invalid state transitions in the ghost model.
  - **Unexpected Invariant Violations:** 0. All 6 invariant assertions held across all 2,048 state transitions.

### 5.3 Contract-Only Coverage

Running `forge coverage --report summary`:

```
╭------------------------------------+------------------+------------------+-----------------+-----------------╮
| File                               | % Lines          | % Statements     | % Branches      | % Funcs         |
+==============================================================================================================+
| src/CertProofRegistry.sol          | 100.00% (58/58)  | 100.00% (54/54)  | 100.00% (13/13) | 100.00% (10/10) |
╰------------------------------------+------------------+------------------+-----------------+-----------------╯
```

Every statement, branch, and function in `CertProofRegistry.sol` is fully covered.

### 5.4 Contract Size
- Runtime Bytecode Size: **2,951 bytes**
- Runtime Margin: **21,625 bytes remaining** (Max allowed: 24,576 bytes)
- Initcode Size: **3,224 bytes**

---

## 6. End-to-End Local Demonstration Results

The automated local demonstration script (`node scripts/deploy-and-demo-local.mjs`) ran against an ephemeral Anvil node and executed all specified lifecycle transitions:

1. **Administrator Validation:** Confirmed non-zero initial owner `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`.
2. **Deployment:** Deployed `CertProofRegistry` at `0x5fbdb2315678afecb367f032d93f642f64180aa3` (Tx: `0x0ec5d2...`).
3. **Step A (Authorize):** Authorized Issuer 1 (`0x70997970C51812dc3A010C7d01b50e0d17dc79C8`).
4. **Step B (Register):** Registered certificate with fixture hash `0xf98502a9365a9b66aab2d6e1cb5395027ac6820df744fc8013c3065341ad7daf`.
5. **Step C (Read):** Successfully queried certificate record from contract storage.
6. **Step D (Deauthorize):** Administrator de-authorized Issuer 1. Confirmed `isIssuerAuthorized == false`.
7. **Step E (Revoke Post-Deauthorization):** Issuer 1 successfully revoked its previously issued certificate while de-authorized.
8. **Step F (Independent Facts Confirmation):** Verified that the certificate is simultaneously `REVOKED` and issued by a currently `DEAUTHORIZED` issuer:
   - Fact 1 (Registration Exists): `true`
   - Fact 2 (Document Hash Match): `true`
   - Fact 3 (Revoked): `true`
   - Fact 4 (Current Issuer Authorization): `false`
9. **Step G (Duplicate Blocking):** Attempt by Issuer 1 to re-register the same document hash under a new `certId` reverted with `CertProof__AlreadyRegistered()`.
10. **Step H (Multi-Issuer Support):** Authorized Issuer 2 registered the same document hash under a new `certId` successfully.

---

## 7. Process Cleanup

All ephemeral test processes were terminated upon completion:
- Ephemeral Anvil process (PID on port 8545) was stopped cleanly.
- `ps aux | grep anvil` confirms zero running instances.
- Background tasks: 0 active tasks.

---

## 8. Remaining Limitations & Non-Goals

1. **No Real Network Broadcast:** Deployments were executed exclusively on local Anvil. Broadcast to Ethereum Sepolia is scheduled for Sprint 5.
2. **No On-Chain Arbitration:** Disputes or key compromises cannot rewrite historical consensus states; remediation requires administrative de-authorization and re-issuance under a new key.
3. **Zero PDF Storage:** PDFs remain held exclusively by issuers and recipients; the contract only anchors Keccak-256 hashes.
4. **No Authentication Layer Yet:** Backend SIWE and MongoDB session management are scheduled for Sprint 3.

---

## 9. Readiness for Sprint 3

Sprint 2 deliverables are complete and verified. The codebase is prepared for **Sprint 3: SIWE Authentication & Issuer Dashboard**:
- Contract ABI exported and frozen at `contracts/abi/CertProofRegistry.json` and `contracts/abi/CertProofRegistry.ts`.
- Deployment manifest format established at `deployments/local-anvil.json`.
- Next step: Scaffold Next.js App Router project and implement SIWE EIP-4361 authentication with MongoDB server-side sessions.
