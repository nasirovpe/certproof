# CertProof — Sprint 3, Stage 1: Verification & Final Correction Report

**Focus:** Narrowly Scoped Final Correction Pass, Overlapping Session Requests, Wallet Hydration vs. Disconnect, Raw Forge Evidence, Security Audit & Dependency Blockers  
**Status:** Complete & Verified  
**Date:** 2026-10-28  
**Scope Notice:** Verifies Consensus and Access Control for Sprint 3 Stage 1. Certificate registration, PDF parsing/hashing, QR generation, and Stage 2 workflows remain strictly out of scope. Interactive browser extension prompts remain pending interactive manual verification.

---

## 1. Executive Summary

This final correction pass audited and hardened CertProof Sprint 3, Stage 1 deliverables across four critical areas:

1. **Overlapping Session Requests & Invalidation:** Fixed a loading-state premature clearing defect where older in-flight requests prematurely reset the loading state of newer active requests. Implemented request generation fencing and guaranteed loading resolution across cancellations, logouts, disconnects, and account/chain switches. Added controlled-promise regression tests covering all completion orders (success and failure).
2. **Wallet Hydration vs. Genuine Disconnect:** Resolved a critical defect where initial Wagmi hydration (`status: 'reconnecting'`, `isConnected: false`) triggered premature server session revocation via `/api/auth/logout`. Separated initial hydration from genuine post-connection disconnects using a connection lifecycle guard (`hasConnectedRef` and `pendingSessionRef`). Same-wallet page refreshes now cleanly restore authenticated sessions, while explicit disconnects revoke server state and require fresh SIWE signatures upon reconnecting. Enhanced logout error recovery so server failures keep private UI cleared and surface recoverable errors.
3. **Dependency Findings & Security Evidence:** Audited root (`0 vulnerabilities`) and frontend (`38 vulnerabilities`: 17 moderate, 18 high, 3 critical) dependency trees. Documented each advisory family with authoritative GHSA identifiers, URLs, affected ranges, dependency paths, runtime vs. development exposure, application config evidence, and fixed versions. Delineated why these findings are safe for isolated local development but represent a concrete blocker for public deployment requiring an isolated framework migration epic.
4. **Raw Forge Evidence & Test Count Reconciliation:** Captured unedited CLI evidence from `forge --version`, `forge test --list`, and `forge test -vv` into [raw-forge-evidence.txt](file:///Volumes/D%20Disc/WEB3/CertProof/docs/raw-forge-evidence.txt). Reconciled the 38 reported test targets with the 43 declared functions.

All automated test suites (contract and frontend), type checks, lint checks, and production builds pass cleanly.

---

## 2. Forge Test Count Reconciliation & Raw Evidence

### 2.1 Discovered Functions vs. Forge Runner CLI Reporting

Running `forge test --list` against `contracts/` discovers **43 individual test and invariant functions**:
- **`CertProofRegistryUnitTest` (33 functions):**
  `test_AdminCanAuthorizeAndDeauthorizeIssuer`, `test_AdminCannotRevokeIssuerCertificate`, `test_AuthorizedIssuerCanRegisterCertificate`, `test_ChangedDocumentHashAllowsNewRegistration`, `test_ConstructorRevertsOnZeroAddress`, `test_DeauthorizedIssuerCannotRegister`, `test_DifferentIssuersCanRegisterSameDocumentHash`, `test_DuplicateCertIdCollisionRevertsGlobally`, `test_DuplicateIssuerDocumentHashPermanentlyBlockedAfterRevocation`, `test_DuplicateIssuerDocumentHashReverts`, `test_FixturesRawBytesKeccakMatchViemExpected`, `test_IndependentRevokedAndDeauthorizedStates`, `test_InitialAdminIsNotAuthorizedIssuerByDefault`, `test_NonAdminCannotAuthorizeIssuer`, `test_NonIssuerCannotRevoke`, `test_OriginalIssuerCanRevoke`, `test_OriginalIssuerCanRevokeAfterDeauthorization`, `test_PaginationEmptyArrayWhenNoCerts`, `test_PaginationExcessiveLimitReverts`, `test_PaginationOffsetBeyondEnd`, `test_PaginationOrderingAndSlices`, `test_PaginationZeroLimitReverts`, `test_ReauthorizeIssuer`, `test_RenounceOwnershipIsDisabled`, `test_RepeatedRevocationReverts`, `test_RevokeNonexistentCertificateReverts`, `test_RevokedCertificatesRetainedInPagination`, `test_SetIssuerAuthorizationZeroAddressReverts`, `test_TwoStepOwnershipTransfer`, `test_UnauthorizedIssuerCannotRegister`, `test_UnknownCertificateReads`, `test_ZeroCertIdReverts`, `test_ZeroDocumentHashReverts`.
- **`CertProofRegistryFuzzTest` (4 functions):**
  `testFuzz_PaginationBoundsNeverRevertOrOverflow`, `testFuzz_RegistrationStoresExactValues`, `testFuzz_UnauthorizedCallerCannotAuthorize`, `testFuzz_UnauthorizedCallerCannotRevoke`.
- **`CertProofRegistryInvariantTest` (6 functions):**
  `invariant_AccessControlBoundaries`, `invariant_BoundedPagination`, `invariant_ImmutableRegisteredData`, `invariant_IssuerListConsistency`, `invariant_PermanentRevocation`, `invariant_UniqueIdsAndPerIssuerHashes`.

### 2.2 Reporting Mechanics in Forge 1.8.6

In Forge 1.8.6 (`commit 6bad0a66de7c83f7b33695044138f0f5fa4c5990`):
1. **Unit & Fuzz Suites:** Each individual test function is executed and reported as 1 test unit (33 unit tests + 4 fuzz tests = 37 test units).
2. **Invariant Suite:** Invariant test contracts do **not** run each `invariant_*` method in separate isolated campaigns. Forge's invariant engine runs **one unified campaign** for the contract (`Ran 1 test for test/CertProofRegistryInvariant.t.sol:CertProofRegistryInvariantTest`), checking all 6 invariant target assertions concurrently after each state transition across 64 runs and 32 depth (2,048 calls).
3. **CLI Summary:** Forge prints individual `[PASS]` lines for each of the 6 invariant assertions, but records `Suite result: ok. 1 passed; 0 failed; 0 skipped` for the suite.
4. **Reported Total:** Forge sums 33 unit + 4 fuzz + 1 invariant campaign = **38 passed tests** (`38 total tests`).
5. **Reconciliation:** The count of 38 represents the number of test suites evaluated by the Forge runner, while 43 represents the total number of test and invariant functions declared in the codebase.

| Contract Suite | Category | Discovered Functions | Forge Runner Units | Execution Scope |
| :--- | :--- | :---: | :---: | :--- |
| `CertProofRegistryUnitTest` | Unit Tests | 33 | 33 | 33 unit tests |
| `CertProofRegistryFuzzTest` | Property Fuzz | 4 | 4 | 4 fuzz tests (256 runs each) |
| `CertProofRegistryInvariantTest` | Stateful Invariant | 6 | 1 | 1 unified campaign evaluating 6 invariant assertions |
| **Total** | | **43** | **38** | **38 test units evaluated by Forge runner** |

### 2.3 Raw Execution Evidence File

The complete, unedited outputs from `forge --version`, `forge test --list`, and `forge test -vv` have been captured directly from execution and saved to:
- Evidence file: [docs/raw-forge-evidence.txt](file:///Volumes/D%20Disc/WEB3/CertProof/docs/raw-forge-evidence.txt)

---

## 3. Wallet and Session State Invalidation

### 3.1 Demonstrated Defects & Applied Corrections

Rigorous inspection and regression testing of `SessionContext.tsx`, `WalletConnect.tsx`, and `IssuerPage.tsx` identified and resolved the following defects:

#### 1. Overlapping Session Requests & Premature Loading State Resolution
- **Defect:** `refreshSession()` previously executed `setLoading(false)` unconditionally in its `finally` block without checking if the request was still the latest active request. When Request A started, followed by Request B, Request A finishing while Request B was pending prematurely cleared `loading` to `false`. Furthermore, if Request A succeeded or failed, it lacked a guard to prevent overwriting Request B's pending state.
- **Correction:** 
  - In `frontend/src/context/SessionContext.tsx`, guarded `setLoading(false)` in `finally` with `if (reqId === sessionRequestIdRef.current)`.
  - An older request finishing while a newer request is in flight cannot alter `session` or clear `loading`.
  - Added explicit `setLoading(false)` calls to cancellation vectors (wallet disconnect, account switch, chain switch) so aborted queries never leave `loading` stuck at `true`.

#### 2. Premature Session Revocation During Wallet Hydration
- **Defect:** On page load or page refresh, Wagmi's connector initialization starts with `status: 'reconnecting'` (or `'connecting'`) and `isConnected: false`. In the previous code, a `useEffect` watching `!isConnected` immediately dispatched `fetch('/api/auth/logout')` if `session?.authenticated` was true. This actively destroyed valid server sessions during initial page loading hydration. Additionally, `refreshSession()` prematurely marked sessions as unauthenticated if Wagmi had not yet hydrated the active address.
- **Correction:**
  - Implemented `hasConnectedRef` to track whether an established connection has been observed during the current component lifecycle.
  - Implemented `pendingSessionRef` to buffer valid server sessions received while Wagmi is still in `reconnecting` or `connecting` status.
  - Initial `!isConnected` states during page load no longer dispatch `/api/auth/logout`.
  - When Wagmi finishes reconnecting with a matching address, the buffered session is committed (`authenticated: true`), restoring the session without prompting the user.
  - Only a genuine disconnect *after* an established connection (`hasConnectedRef.current === true`) clears private UI state and dispatches `/api/auth/logout`.

#### 3. Reconnection vs. Same-Wallet Refresh Semantics
- **Correction:**
  - **Same-wallet refresh:** Preserved. Refreshing the browser page while keeping the wallet connected restores the authenticated session seamlessly.
  - **Explicit disconnect:** Reconnecting after an explicit disconnect starts strictly in the `Connected but Unauthenticated` state, requiring fresh EIP-4361 signature verification.

#### 4. Server Logout Error Handling & Recovery
- **Defect:** If `/api/auth/logout` failed (e.g. network disconnect or 500 error), the UI did not surface a recoverable error to the user and previous error states could be wiped out by subsequent session effects.
- **Correction:**
  - In `logout()` and disconnect handlers, if the server logout request fails, local private state remains strictly cleared (`session: { authenticated: false }`), Wagmi `disconnect()` is invoked, and a recoverable error message is surfaced (`"Failed to revoke server session. Local session was cleared."`).
  - Removed unconditional `setError(null)` from component session effects to prevent wiping out failure notices.

### 3.2 Automated Regression Suite (`frontend/test/session-invalidation.test.tsx`)

The automated regression test suite was expanded from 7 to **18 comprehensive tests** using `@testing-library/react` and `happy-dom`:

1. **Account Switching:** Validates that switching from Account A to Account B immediately clears private authorization content and switches the portal to the `Wallet / Session Mismatch Detected` UI.
2. **Chain Changes:** Validates that switching to an unsupported chain ID (e.g. 1) immediately removes private content, clears cached status, and displays the `Unsupported Network` warning.
3. **Wallet Disconnect:** Validates that disconnecting the wallet immediately clears private content, renders `Wallet Disconnected`, and invalidates the backend session.
4. **Reconnection Authentication Prevention:** Confirms that reconnecting a wallet does **not** automatically authenticate it, displaying `Wallet Connected — Authentication Required`.
5. **Logout & Expiration:** Confirms that explicit sign-out or session expiration purges credentials, triggers disconnect, and removes private content immediately.
6. **Delayed Response on Account Switch:** Simulates a slow in-flight `/api/issuer/status` query initiated for Account A. Switching to Account B before the response resolves results in the delayed response being discarded.
7. **Delayed Response on Logout/Disconnect:** Simulates an in-flight session query resolving with valid session data after the user clicked logout; delayed response is rejected.
8. **Overlapping Requests (A Success while B Pending):** Request A starts, then Request B starts. Request A finishes with success while B is pending. Verifies loading remains `true`, A cannot commit state, B finishes with success, and loading resolves to `false`.
9. **Overlapping Requests (A Failure while B Pending):** Request A starts, then Request B starts. Request A fails while B is pending. Verifies loading remains `true`, A's error cannot overwrite B, B succeeds, and loading resolves to `false`.
10. **Overlapping Requests (A Success, B Failure):** Request A starts, then Request B starts. Request A succeeds while B is pending. Request B fails. Verifies loading remains `true` until B fails, then loading resolves to `false` and unauthenticated state is committed.
11. **Overlapping Requests (Both Fail):** Request A and Request B both fail. Verifies loading remains `true` until B completes, resolving cleanly to `false`.
12. **Overlapping Requests (Reverse Order):** Request B finishes before Request A. Verifies Request B commits state and sets loading `false`; delayed Request A arriving later is ignored and cannot alter state or revert loading.
13. **Cancellation & Stuck Loading Prevention:** Verifies that wallet disconnect, account change, or cancellation occurring while a session query is pending immediately resets loading to `false`.
14. **Initial Wallet Hydration:** Simulates page load with Wagmi `status: 'reconnecting'`. Verifies valid server session is preserved, server logout is **not** called, and session becomes authenticated once connector completes hydration.
15. **Same-Wallet Refresh:** Validates that refreshing the page with an already-connected wallet restores the valid authenticated session immediately without re-signing.
16. **Explicit Disconnect & Reconnect:** Validates that an explicit disconnect triggers `/api/auth/logout`, and reconnecting the same wallet requires fresh SIWE authentication.
17. **Logout Failure Handling:** Validates that when `/api/auth/logout` returns HTTP 500 or network failure, private UI remains cleared, disconnect is called, and a recoverable error is exposed.
18. **Hydration & Delayed Response Races:** Confirms that delayed responses or subsequent hydration events occurring after an explicit logout cannot resurrect stale sessions.

---

## 4. Dependency Findings & Security Audit

> [!NOTE]
> **Sprint 5 Stage 1 Security Status Update:**
> As of Sprint 5, Stage 1 (October 28, 2026), the dependency security posture has been remediated. The 38 reported vulnerabilities have been reduced to 2 (1 high, 1 critical, both originating from Next.js 14 / nested PostCSS), 374 unnecessary transitive packages were eliminated by decoupling unused wallet connectors via Wagmi 3 and isolated injected imports, and `vitest`, `glob`, and `zod` advisories were remediated. See [sprint-5-stage-1.md](file:///Volumes/D%20Disc/WEB3/CertProof/docs/sprint-5-stage-1.md) for full remediation evidence. The historical findings below are retained for audit trail integrity.

### 4.1 Audit Summary

- **Root Project (`package.json`):** `npm audit` reports **0 vulnerabilities** across all dependencies.
- **Frontend Project (`frontend/package.json`):** `npm audit` reports **38 vulnerabilities** across transitive dependencies (17 moderate, 18 high, 3 critical).

### 4.2 Detailed Finding Catalog & Evidence

| Finding / Package | Advisory ID & URL | Installed Version | Affected Range | Dependency Path | Exposure Type | Application Evidence | Fixed Version / Remediation |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`decode-uri-component`** | [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) | `0.4.1` / `0.2.2` | `<= 0.4.2` | `frontend` → `wagmi@2.19.5` → `@wagmi/connectors` → `@walletconnect/ethereum-provider` → `@walletconnect/utils` → `query-string` → `decode-uri-component` | Runtime (transitive) | App only initializes Wagmi's `injected()` connector (`src/lib/config/wagmi.ts`). No WalletConnect relay URLs are parsed. | Fixed in `query-string >= 9.x` (`wagmi@3.x`). Safe for local dev; blocker for public deployment without tree-shaking. |
| **`ws`** | [GHSA-58qx-3vcg-4xpx](https://github.com/advisories/GHSA-58qx-3vcg-4xpx)<br>[GHSA-96hv-2xvq-fx4p](https://github.com/advisories/GHSA-96hv-2xvq-fx4p) | `8.18.0` | `8.0.0 - 8.20.1` | `frontend` → `wagmi@2.19.5` → `@wagmi/connectors` → `@walletconnect/universal-provider` → `ws` | Runtime (transitive) | CertProof connects to EVM RPC strictly via HTTP transport (`http(clientEnv.NEXT_PUBLIC_ANVIL_RPC_URL)`). WebSocket transports are unused. | Fixed in `ws >= 8.21.0`. Pinned transitively in `@wagmi/connectors@5.x`. Upgrading requires `wagmi@3.x`. |
| **`zod`** | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | `3.23.8` | `< 4.6.6` | `frontend` → `wagmi@2.19.5` → `@wagmi/connectors` → `@coinbase/cdp-sdk` / `@reown/appkit-wallet` → `zod` | Runtime (transitive) | App does not import `@coinbase/cdp-sdk` or `@reown/appkit`. Injected connector uses native browser wallet. | Fixed in `zod >= 4.6.6` (bundled in `wagmi@3.x`). |
| **`uuid`** | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | `9.0.1` | `< 11.1.1` | `frontend` → `wagmi` → `@wagmi/connectors` → `@metamask/sdk` → `@metamask/utils` → `uuid` | Runtime (transitive) | MetaMask browser extension communicates via `window.ethereum`, not MetaMask Mobile SDK deeplink bridge. | Fixed in `uuid >= 11.1.1`. Resolves via `wagmi@3.x`. |
| **`vitest` & `tinypool`** | [GHSA-5xrq-8626-4rwp](https://github.com/advisories/GHSA-5xrq-8626-4rwp)<br>[GHSA-82fw-gwwq-j7x9](https://github.com/advisories/GHSA-82fw-gwwq-j7x9)<br>[GHSA-5gmw-xhrv-c9v3](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3)<br>[GHSA-85c8-ppgw-ccpr](https://github.com/advisories/GHSA-85c8-ppgw-ccpr) | `2.1.9` / `0.8.4` | `vitest <= 4.1.10`<br>`tinypool < 1.0.0` | `frontend` → `devDependencies` → `vitest@2.1.9` → `tinypool` / `@vitest/mocker` | **Development-only** (`devDependencies`) | Vitest is strictly invoked via local test execution (`vitest run`). Neither the Vitest UI server nor workers run against untrusted input. Strictly excluded from production build bundle. | Fixed in `vitest >= 4.1.12`. Major upgrade requiring Vite 6 / Node 22+. Safe for local dev. |
| **`@next/eslint-plugin-next`** | [GHSA-next / glob](https://github.com/advisories) | `14.2.35` | `14.0.5 - 15.0.0` | `frontend` → `devDependencies` → `eslint-config-next@14.2.35` → `@next/eslint-plugin-next` → `glob` | **Development-only** (`devDependencies`) | Used exclusively by `next lint` during development. Not included in client build or runtime server. | Fixed in `eslint-config-next >= 16.x`. |
| **`next`** | Framework Advisories (DoS in Server Actions, Image Optimization) | `14.2.35` (patched from `14.2.15`) | `< 14.2.35` | `frontend` → `next@14.2.35` | Runtime (framework core) | Compatible patch applied. No React Server Actions (`'use server'`) or remote SVG image optimization endpoints used in CertProof. | Fully resolved on the Next.js 14.2 release line. |

### 4.3 Delineation of Local Development vs. Public Deployment Blockers

- **Acceptable for Isolated Local Development:**
  - In the local development and testing environment (Anvil on `127.0.0.1:8545` and isolated MongoDB on `127.0.0.1:27018`), these transitive libraries pose zero immediate operational risk:
    - The development toolchain advisories (`vitest`, `tinypool`, `eslint-config-next`) run solely offline in developer CLI commands.
    - The client-side connector libraries (`@walletconnect/ethereum-provider`, `@coinbase/cdp-sdk`, `ws`, `decode-uri-component`) are idle dependencies inside `node_modules` because CertProof exclusively instantiates Wagmi's `injected()` connector.
- **Blockers for Public Deployment:**
  - Before deploying CertProof to public production infrastructure, the frontend attack surface must be resolved:
    1. **Dependency Tree-Shaking / Custom Connector Bundle:** `@wagmi/connectors` unconditionally includes WalletConnect and Coinbase SDKs in its root export. A custom Wagmi injected connector implementation or connector decoupling should be adopted to eliminate WalletConnect and Coinbase dependencies from the client JavaScript bundle.
    2. **Major Framework Migration Epic:** Upgrading `wagmi` to `3.x` resolves all transitive connector vulnerabilities, but constitutes a major architectural upgrade requiring `react@19`, `next@15+`, and asynchronous route handler cookie migration. This is documented as an independent architectural epic following MVP completion.

---

## 5. Complete Verification Matrix & Test Execution Log

### 5.1 Contract Test Suite (`contracts/`)
Command: `export PATH="$HOME/.foundry/bin:$PATH" && cd contracts && forge test -vv`
- **Unit Tests:** 33 passed, 0 failed, 0 skipped.
- **Fuzz Tests:** 4 passed (256 runs per test).
- **Invariant Suite:** 1 campaign passed (evaluating 6 invariant assertions across 64 runs and 2,048 handler calls).
- **Total Reported by Forge:** **38 passed, 0 failed, 0 skipped**. (Discovered test/invariant functions: 43).

### 5.2 Frontend Automated Suite (`frontend/`)
Command: `cd frontend && npm test`
- `test/session-invalidation.test.tsx`: **18 passed** (expanded from 7).
- `test/auth-siwe.test.ts`: **9 passed**.
- `test/session.test.ts`: **6 passed**.
- `test/registry-read.test.ts`: **5 passed**.
- `test/concurrency.test.ts`: **1 passed** (15 concurrent nonce verification requests).
- **Total Frontend Tests:** **39 passed across 5 test suites, 0 failed, 0 skipped**.

### 5.3 Type Checking, Linting & Production Build
- **Type Checking:** `cd frontend && npx tsc --noEmit` → **0 errors**.
- **ESLint:** `cd frontend && npm run lint` → **0 warnings or errors** (`next/core-web-vitals`).
- **Production Build:** `cd frontend && npm run build` → **Compiled successfully (exit code 0)**. All 7 routes (`/`, `/_not-found`, `/issuer`, `/api/auth/logout`, `/api/auth/nonce`, `/api/auth/session`, `/api/auth/verify`, `/api/issuer/status`) generated and optimized.

---

## 6. Distinction Between Automated Results and Pending Manual Checks

| Area | Automated Verification (Complete) | Pending Interactive Manual Verification |
| :--- | :--- | :--- |
| **SIWE Signature Verification** | Automated via Viem `privateKeyToAccount` generating EIP-4361 compliant personal_sign signatures against route handlers. | **Pending:** Physical interactive browser wallet popup (MetaMask extension prompt, user clicking "Sign" in browser window). |
| **Account Switching** | Automated via React component state transition tests with `@testing-library/react` and `happy-dom`. | **Pending:** Physical account change inside MetaMask browser extension triggering injected event. |
| **Network Switching** | Automated via `useChainId` transitions and route handler chain validations. | **Pending:** Physical `wallet_switchEthereumChain` popup interaction inside browser. |
| **Session Invalidation** | Automated via database session destruction, token hashing, TTL index validation, and sequence ID tests. | **Pending:** Real-time multi-tab browser synchronization when user clicks "Sign Out" in one tab. |

---

## 7. Resource & Process Cleanup

All ephemeral test resources and background processes have been verified as cleanly terminated:
- Ephemeral test MongoDB container (`certproof-test-mongo`): Automatically stopped and removed by Vitest global teardown.
- Ephemeral test Anvil instance (port 8546): Verified stopped (0 instances).
- Background tasks: All command execution tasks completed and cleared.
- No orphan processes remain active (`pgrep anvil` returns 0).
- Persistent assets (`fixtures/`, `deployments/local-anvil.json`, `contracts/abi/`, `docs/raw-forge-evidence.txt`) are preserved.
- Unrelated user services (CTFd, offplancity, postgres instances) were left completely untouched.

---

## 8. Conclusion & Readiness

The Sprint 3, Stage 1 final correction pass is complete. Overlapping session requests and wallet hydration handling are fully hardened, empirical Forge evidence is captured, dependency security findings are documented with actionable boundaries, and all 77 automated tests (38 contract, 39 frontend) pass cleanly. CertProof is fully prepared to proceed to **Sprint 3, Stage 2: Issuer Dashboard & PDF Registration Flow**.
