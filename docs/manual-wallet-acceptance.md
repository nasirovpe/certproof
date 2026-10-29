# CertProof — Manual Interactive Wallet Acceptance Guide

**Sprint Focus:** Stage 2 Packaging, Deployment Configuration, and Interactive Acceptance Preparation  
**Status:** Acceptance Procedures Defined; Interactive Injected-Wallet Checks Marked PENDING  
**Environment:** Local Anvil Node (Chain ID: 31337) / Sepolia Testnet Staging (Chain ID: 11155111)  
**Security Notice:** Local test funds only. Never import personal wallets, production private keys, or seed phrases into development environments.

---

## 1. Acceptance Scope & Execution Context

Automated test suites (Vitest, Foundry, and headless/real Chrome Playwright E2E) confirm application logic, cryptographic signing, API contracts, and Web Worker execution. However, **interactive browser extension acceptance** requires verifying the exact user experience when interacting with an authentic browser wallet extension (e.g. MetaMask, Rabby, Rainbow, Brave Wallet) injected into `window.ethereum`.

### 1.1 Automated vs. Manual Status Matrix

| Flow | Automated Coverage | Interactive Extension Check | Status | Exact Blocker / Requirement |
| :--- | :--- | :--- | :---: | :--- |
| **1. Connect vs. Authenticate** | `test/session-invalidation.test.tsx` (18 tests) | Manual browser run with injected extension | **PENDING** | Requires user interaction with extension connection modal and signature dialog |
| **2. SIWE & Session Persistence** | `test/auth-siwe.test.ts` (9 tests), `test/session.test.ts` | Page reload after signing SIWE challenge | **PENDING** | Requires browser cookie inspection and visual session rehydration check |
| **3. Account Change & Disconnect** | `test/session-invalidation.test.tsx` | Wallet account switch in extension popup | **PENDING** | Requires extension `accountsChanged` and `chainChanged` event firing |
| **4. Registration & Wallet Rejection** | `test/certificate-registration-anvil.test.ts` (8 tests) | User clicks "Reject" in wallet popup | **PENDING** | Requires human cancellation in wallet approval dialog |
| **5. Revocation & Deauthorization** | `test/certificate-revocation-anvil.test.ts` (5 tests) | Issuer revoking post admin deauthorization | **PENDING** | Requires admin + issuer account switching in live browser extension |
| **6. Pending Transaction Recovery** | `test/certificate-recovery.test.ts` (13 tests) | Browser tab closure during pending tx | **PENDING** | Requires closing browser window during mempool pending state |
| **7. Public Verification & QR Navigation** | `test/verify-browser-e2e.mjs` (8/8 real-browser stages) | Mobile device scanning rendered QR code | **PENDING** | Requires physical camera/phone scanning local/tunnel QR code |

> [!NOTE]
> Per sprint guidelines: Headless browser tests or synthetic Viem `walletClient` scripts **do not count** as interactive extension acceptance. These manual steps must be executed by an operator with a desktop browser wallet extension.

---

## 2. Test Environment Setup

### 2.1 Prerequisites
1. Local Docker environment running:
   ```bash
   docker compose --profile local-anvil up -d
   ```
2. Browser with MetaMask or equivalent EVM extension installed.
3. Configure Local Anvil Network in wallet extension:
   - **Network Name:** Anvil Local
   - **New RPC URL:** `http://127.0.0.1:8545`
   - **Chain ID:** `31337`
   - **Currency Symbol:** `ETH`
4. Import Dedicated Local Disposable Test Accounts (Pre-funded Anvil accounts):
   - **Administrator:** `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`  
     *(Private key: `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`)*
   - **Authorized Issuer 1:** `0x70997970C51812dc3A010C7d01b50e0d17dc79C8`  
     *(Private key: `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`)*
   - **Unauthorized Account:** `0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC`  
     *(Private key: `0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a`)*

---

## 3. Step-by-Step Manual Acceptance Checklist

### Check 1: Connect vs. Authenticate (Read-Only Separation)
1. Navigate to `http://localhost:3010/issuer`.
2. Observe state: App shows "Connect Wallet". No session cookie exists.
3. Click "Connect Wallet" and approve connection in wallet extension.
4. **Expected Result:**
   - Wallet connects (address displayed in navigation bar).
   - Application displays: "Wallet connected, but you are not signed in. Click 'Sign In with Ethereum' to authenticate."
   - Private dashboard controls and certificate issuance forms remain hidden.
   - Network inspector confirms no session cookie or `/api/auth/verify` call has been made yet.

### Check 2: SIWE Signature & Session Persistence
1. With wallet connected, click "Sign In with Ethereum".
2. Extension opens a signature request modal displaying EIP-4361 text:
   - Domain: `localhost:3010`
   - Address: Current wallet address
   - URI: `http://localhost:3010`
   - Nonce: Cryptographic single-use nonce
3. Click "Sign" in wallet extension.
4. **Expected Result:**
   - App calls `/api/auth/verify`.
   - On success, dashboard displays issuer management interface.
   - HTTP response sets `certproof_session` cookie (HttpOnly, SameSite=Lax).
5. Refresh the browser page (`Cmd+R` / `F5`).
6. **Expected Result:**
   - Session persists immediately upon page load without requesting another signature.

### Check 3: Account Switching, Network Mismatch, Disconnect & Logout
1. While authenticated as Issuer 1, open wallet extension and switch active account to Unauthorized Account (`0x3C44...`).
2. **Expected Result:**
   - App detects `accountsChanged` event immediately.
   - Private dashboard content disappears instantly.
   - UI warns: "Active account differs from signed session. Please re-authenticate."
3. Switch wallet extension network to Ethereum Mainnet or Sepolia (Chain ID != 31337).
4. **Expected Result:**
   - App displays "Wrong Network" indicator and prompts user to switch back to Anvil (Chain ID 31337).
5. Switch back to Anvil and switch account back to Issuer 1. Click "Sign Out" / "Logout".
6. **Expected Result:**
   - App calls `/api/auth/logout`.
   - Server clears `certproof_session` cookie.
   - State returns to read-only connected state ("Sign In with Ethereum").
7. In the wallet extension settings/connected sites, disconnect `localhost:3010`.
8. **Expected Result:**
   - App detects `disconnect` / account clearing.
   - Application state resets to the unauthenticated, disconnected state ("Connect Wallet").

### Check 4: Certificate Registration & User Rejection
1. Sign back in as Authorized Issuer 1.
2. Drag and drop `fixtures/original.pdf` into the issuance dropzone.
3. Observe client-side hashing: Web Worker calculates Keccak-256 without sending PDF bytes over network.
4. System simulates transaction against smart contract (`simulateCertificateRegistration`).
5. Click "Register Certificate on Blockchain".
6. Wallet extension opens transaction prompt (Contract: `CertProofRegistry`, Method: `registerCertificate`).
7. In wallet extension, click **"Reject"** / **"Cancel"**.
8. **Expected Result:**
   - App handles rejection gracefully without crashing or freezing.
   - UI shows error banner: "Transaction rejected by user."
   - Form data and computed hash are preserved; user can retry or adjust.
9. Click "Register Certificate on Blockchain" again, and this time click **"Confirm"** in wallet.
10. **Expected Result:**
    - App displays pending transaction spinner with transaction hash.
    - Upon block confirmation, shows success receipt with Certificate ID.

### Check 5: Revocation & Post-Deauthorization Invariants
1. On Issuer Dashboard, locate the registered certificate.
2. Click "Revoke Certificate".
3. Provide revocation reason and confirm prompt in wallet extension.
4. **Expected Result:**
   - Transaction confirms; certificate status updates to "REVOKED" on-chain.
5. In wallet extension, switch to Administrator (`0xf39F...`).
6. Deauthorize Issuer 1 using the admin controls.
7. Switch back to Issuer 1.
8. Attempt to register a new certificate.
9. **Expected Result:**
   - Pre-flight simulation warns: "Your wallet is no longer authorized to issue certificates."
   - Button is disabled; wallet prompt is prevented.
10. Inspect previously registered certificate.
11. **Expected Result:**
    - Original certificate remains viewable with immutable historical registration data and revoked badge.

### Check 6: Pending Transaction Recovery & Crash Handling
1. Start registration for another certificate (`fixtures/duplicate.pdf`).
2. Click "Register Certificate" and confirm in wallet extension.
3. Immediately before confirmation completes, refresh or close the browser tab.
4. Re-open `http://localhost:3010/issuer`.
5. **Expected Result:**
   - Application checks the `sessionStorage` pending operation draft (`certproof_pending_registration`), which stores strictly minimal non-sensitive metadata (`certId`, `documentHash`, `issuerAddress`, `chainId`, `registryAddress`, `stage`, `txHash`) with zero file bytes.
   - The application verifies that active wallet address, active chain ID, and configured registry contract match the draft scope.
   - The application queries the on-chain transaction receipt for the broadcasted transaction hash.
   - UI notifies user: "Recovered pending registration; transaction succeeded on-chain."
   - The pending draft is purged from `sessionStorage` upon successful confirmation.

### Check 7: Zero-Wallet Public Verification & QR Navigation
1. Open a new private/incognito browser window with **no wallet extension enabled**.
2. Navigate to `http://localhost:3010/verify/<CERT_ID>`.
3. **Expected Result:**
   - Page loads cleanly with HTTP 200.
   - Zero wallet prompts, Web3 injection warnings, or SIWE prompts occur.
   - Authoritative contract status, block timestamp, and issuer address are displayed.
   - Displays "DOCUMENT HAS NOT BEEN COMPARED".
4. Drag and drop `fixtures/original.pdf`.
5. **Expected Result:**
   - Web Worker calculates hash locally.
   - UI displays green banner: "BYTE-FOR-BYTE IDENTICAL".
6. Click "Share Certificate" and inspect QR code.
7. Scan QR code using a mobile device or second browser.
8. **Expected Result:**
   - URL points to the canonical `/verify/<CERT_ID>` endpoint.

---

## 4. Acceptance Sign-Off Log

| Check Item | Date | Tested By | Platform / Extension | Result | Notes |
| :--- | :--- | :--- | :--- | :---: | :--- |
| Automated Browser E2E | 2026-10-29 | CI / Playwright | Chrome 156.0.8078.73 | **PASS** | 8/8 automated stages passed cleanly |
| Interactive Wallet Connect | — | Operator | MetaMask / Desktop | **PENDING** | Awaiting manual tester execution |
| SIWE Session Refresh | — | Operator | MetaMask / Desktop | **PENDING** | Awaiting manual tester execution |
| Account Switch Invalidation | — | Operator | MetaMask / Desktop | **PENDING** | Awaiting manual tester execution |
| Registration Rejection | — | Operator | MetaMask / Desktop | **PENDING** | Awaiting manual tester execution |
| Revocation Flow | — | Operator | MetaMask / Desktop | **PENDING** | Awaiting manual tester execution |
| Pending Recovery | — | Operator | MetaMask / Desktop | **PENDING** | Awaiting manual tester execution |
| Public QR Navigation | — | Operator | Mobile Camera / Browser | **PENDING** | Awaiting manual tester execution |
