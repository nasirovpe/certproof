# CertProof — Sprint 3, Stage 1: Application Setup, Wallet Connection, SIWE Authentication & Protected Issuer Portal

**Sprint Focus:** Next.js App Router Setup, Wagmi v2 / Viem, SIWE (EIP-4361), MongoDB Server-Side Sessions, and Minimal Protected Issuer Page  
**Status:** Complete & Verified  
**Date:** 2026-10-28  
**Notice:** This deliverable implements authentication and access-control verification for local and testnet staging. It has not undergone an independent formal security audit and is not claimed as production-ready.

---

## 1. Summary of Changes

### 1.1 Sprint 2 Report Reconciliation
- **Reconciled Test Counts in `docs/sprint-2-completion-report.md`:** Clarified that `forge test --list` discovers 43 test and invariant functions across the codebase (33 unit functions, 4 fuzz functions, and 6 invariant assertion functions). Forge's invariant runner executes the invariant contract as a single campaign evaluating all 6 invariant assertions across 64 runs and 2,048 handler calls, reporting 38 test targets (33 unit + 4 fuzz + 1 invariant campaign) in its summary.
- **Recorded Detailed Invariant Metrics:** Distinguished Forge CLI native metrics (64 runs, depth 32, 2,048 handler calls, 0 reverts, 0 discards) from internal handler state variables (attempted vs. executed vs. controlled skips and expected reverts).

### 1.2 Web Application Setup (`frontend/`)
- Initialized Next.js App Router (`14.2.35`) with TypeScript (`^5.6.3`), Tailwind CSS (`^3.4.14`), Wagmi (`^2.12.25`), Viem (`^2.21.26`), SIWE (`^2.3.2`), and MongoDB driver (`^6.10.0`).
- Configured webpack resolve fallbacks in `frontend/next.config.mjs` for optional external transport packages.
- Added persistent `NetworkNotice.tsx` component displaying active testnet / local mode banner and wrong-network warnings.
- Reused generated registry contract ABI from `contracts/abi/CertProofRegistry.ts` directly into `frontend/src/lib/abi/CertProofRegistry.ts`.
- Validated environment variables with strict server/client separation in `frontend/src/lib/config/env.ts`.

### 1.3 Wallet Connection & State Management
- Built `frontend/src/components/WalletConnect.tsx` supporting injected browser wallets (`injected()`).
- Distinct visual UI states implemented:
  1. `Disconnected`
  2. `Wrong Network` (with 1-click switch chain trigger)
  3. `Connected but Unauthenticated` (with explicit warning that connecting a wallet does not authenticate)
  4. `Authenticated` (SIWE verified badge)
  5. `Wallet / Session Mismatch` (when active wallet address differs from session address)
- Implemented immediate UI state clearing on wallet disconnect, account switch, network change, or session expiration.
- Applied active account ref guards (`activeAddressRef`) to eliminate race conditions where delayed responses from a prior wallet restore stale data.

### 1.4 SIWE Authentication & Server-Side Session Security
- **Atomic Nonce Redemption (`frontend/src/lib/auth/siwe.ts`):** Single-use nonces generated via `siwe.generateNonce()`. Redeemed atomically via MongoDB `findOneAndUpdate` (`{ nonce, used: false, expiresAt: { $gt: now } }`). Concurrent requests for the same challenge yield strictly one success.
- **Browser-Challenge Binding:** Each challenge is bound to the initiating browser via a cryptographically random token stored in an `HttpOnly, SameSite=Lax` cookie (`certproof_siwe_bind`).
- **Signature & Claim Verification:** Validates exact domain, URI prefix, chain ID, nonce, issued-at timestamp, and cryptographic personal_sign signature.
- **Session Token Hashing (`frontend/src/lib/auth/session.ts`):** Only SHA-256 hashes of 32-byte unpredictable session tokens are persisted in MongoDB (`sessions` collection); raw tokens are never written to the database.
- **Session Rotation & Invalidation:** On successful authentication, any prior session cookie is invalidated in the database before issuing the new session. On logout (`/api/auth/logout`), session hashes are purged.
- **Explicit Application-Level Expiry:** `getSession()` validates `expiresAt > new Date()` in code; does not rely solely on MongoDB background TTL workers.
- **CSRF Protection:** Mutation endpoints (`/api/auth/verify`, `/api/auth/logout`) validate the `Origin` header against configured `NEXT_PUBLIC_APP_URL`.
- **Process-Local Rate Limiting (`frontend/src/lib/auth/rate-limit.ts`):** In-memory sliding window rate limiter with a 5,000-IP capacity limit and periodic pruning.
- **Cache-Control:** All authentication and private session responses return `Cache-Control: no-store, no-cache, must-revalidate, private`.
- **Zero Sensitive Logging:** Signatures, raw session tokens, cookies, and secrets are strictly excluded from server logs.

### 1.5 Minimal Protected Issuer Page (`frontend/src/app/issuer/page.tsx`)
- Enforces valid server session (`/api/issuer/status`).
- Requires connected wallet to match the authenticated session address before showing private status.
- Queries `isIssuerAuthorized(address)` directly from `CertProofRegistry.sol` via Viem public client.
- Differentiates:
  - `Authorized`: Connected & authenticated wallet is an authorized issuer on-chain.
  - `Unauthorized`: Connected & authenticated wallet lacks issuance rights.
  - `Wrong Network`: Connected to incorrect chain.
  - `Missing Deployment`: Contract address has no deployed bytecode.
  - `Loading`: RPC query in progress.
  - `RPC Failure`: Transport timeout or node offline (explicitly flagged as a network failure, never misreported as "Unauthorized").
- Certificate registration, PDF hashing, QR codes, and dashboard batches are deferred to Stage 2.

---

## 2. Startup & Development Commands

### 2.1 Environment Configuration
Create `frontend/.env.local`:
```bash
# Server-Side Configuration (Private)
MONGODB_URI=mongodb://127.0.0.1:27018/certproof_dev
SESSION_SECRET=c8d4e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9

# Public Client Configuration
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_CHAIN_ID=31337
NEXT_PUBLIC_REGISTRY_ADDRESS=0x5fbdb2315678afecb367f032d93f642f64180aa3
NEXT_PUBLIC_ANVIL_RPC_URL=http://127.0.0.1:8545
```

### 2.2 Local Development Commands
```bash
# 1. Start local Anvil node (in terminal 1)
anvil --port 8545

# 2. Deploy registry contract (in terminal 2)
npm run demo:local

# 3. Start local MongoDB container (in terminal 3)
docker run -d --name certproof-mongo -p 27018:27017 mongo:7.0

# 4. Start Next.js development server (in terminal 4)
npm run web:dev
# Access application at: http://localhost:3000
```

---

## 3. Exact Verification Results

### 3.1 Automated Test Execution Summary
Executed unified test runner `npm run test:all`:

#### Contract Suite (`contracts/` via Forge)
- **Unit Tests (`test/CertProofRegistry.t.sol`):** 33 passed.
- **Fuzz Tests (`test/CertProofRegistryFuzz.t.sol`):** 4 passed (256 runs per test).
- **Stateful Invariant Suite (`test/CertProofRegistryInvariant.t.sol`):** 1 suite passed (evaluating 6 invariant properties over 64 runs and 2,048 handler calls).
- **Total Contract Tests:** 38 passed, 0 failed, 0 skipped.

#### Frontend Automated Suite (`frontend/` via Vitest)
- **Wallet & Session State Invalidation (`test/session-invalidation.test.tsx`):** 7 passed.
  - Account A switching to Account B: private content disappears immediately and mismatch state displays.
  - Chain change: switching to unsupported network clears private content immediately and displays unsupported network banner.
  - Wallet disconnect: private content disappears immediately, UI renders disconnected state, and session is invalidated.
  - Wallet reconnection: reconnecting a disconnected wallet does NOT automatically authenticate it.
  - Logout & expiration: manual sign-out and session expiry immediately purge credentials and clear UI.
  - Delayed response for Account A arriving after switching to Account B is discarded and cannot restore private content.
  - Delayed authenticated response arriving after logout or disconnect is discarded and cannot resurrect session.
- **SIWE & Challenge Verification (`test/auth-siwe.test.ts`):** 9 passed.
  - Challenge generation and expiry.
  - Valid SIWE signature verification with browser binding.
  - Rejection of invalid signature.
  - Rejection of domain mismatch.
  - Rejection of URI mismatch.
  - Rejection of chain ID mismatch.
  - Rejection of cross-browser challenge usage.
  - Rejection of replayed nonce.
  - Rejection of CSRF origin mismatch.
- **Session Management & Indexes (`test/session.test.ts`):** 6 passed.
  - Raw token absence from database (hash-only storage).
  - Active session retrieval.
  - Explicit application-level expiration enforcement.
  - Session rotation on new login.
  - Session destruction on logout.
  - Uniqueness and TTL index validation on collections.
- **Atomic Concurrency (`test/concurrency.test.ts`):** 1 passed.
  - 15 simultaneous parallel verification requests against 1 challenge: strictly 1 succeeded, 14 rejected with `INVALID_CHALLENGE`.
- **Registry Authorization Reads (`test/registry-read.test.ts`):** 5 passed.
  - Authorized issuer confirmation on Anvil.
  - Deauthorized issuer confirmation on Anvil.
  - Unauthorized stranger confirmation.
  - Missing bytecode deployment detection.
  - RPC node failure differentiation (never flagged as unauthorized).
- **Total Frontend Tests:** 28 passed across 5 test suites, 0 failed, 0 skipped.

### 3.2 Type Checking & Production Build
- `npx tsc --noEmit`: 0 errors.
- `npm run lint`: 0 ESLint warnings or errors (`next/core-web-vitals`).
- `npm run build`: Production build succeeded. All 7 static and dynamic route handlers compiled and optimized.

---

## 4. Distinction Between Automated Tests & Pending Manual Checks

| Area | Automated Verification (Complete) | Pending Interactive Manual Verification |
| :--- | :--- | :--- |
| **SIWE Signature Verification** | Verified via Viem `privateKeyToAccount` generating EIP-4361 compliant personal_sign signatures against route handlers. | **Pending:** Interactive browser wallet popup (MetaMask extension prompt, user clicking "Sign" in browser window). |
| **Network Switching** | Verified chain ID mismatch detection and API rejection. | **Pending:** Interactive `wallet_switchEthereumChain` prompt triggering metamask popup inside browser. |
| **Session Invalidation** | Verified via database queries, expiry timestamps, and cookie destruction. | **Pending:** Real-time multi-tab browser synchronization when user clicks "Sign Out" in one tab. |

---

## 5. Process & Resource Cleanup

All processes initiated during verification were cleanly terminated:
- Ephemeral test Anvil instance (PID on port 8546): Stopped.
- Ephemeral test MongoDB container (`certproof-test-mongo` on port 27018): Stopped and removed.
- Background tasks: 0 active tasks.
- No unrelated services or Docker containers were touched.
- All persistent artifacts (`deployments/local-anvil.json`, `fixtures/`, `contracts/abi/`) are preserved.

---

## 6. Readiness for Sprint 3, Stage 2

Stage 1 is complete. The system is prepared for **Sprint 3, Stage 2: Issuer Dashboard & PDF Registration Flow**:
- Next steps: In-memory client-side PDF hashing module, registration form, receipt event decoding, bounded pagination UI, and certificate revocation triggers.
