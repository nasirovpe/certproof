# CertProof — Sprint 5, Stage 2: Packaging, Deployment Configuration & Acceptance Preparation

**Sprint Focus:** Reproducible Multi-Stage Docker Packaging, Deployment Configuration & Identity Integrity, Reverse Proxy IP Trust Hardening, Bounded Smoke Testing, and Interactive Acceptance Preparation  
**Status:** Implementation, Automated Verification & Package Smoke Tests Complete; Interactive Extension Acceptance Procedures Documented and Marked Pending  
**Date:** 2026-10-29  
**Notice:** Unaudited Educational / Testnet Prototype. Zero dependency vulnerabilities and clean smoke tests do not substitute for a formal third-party smart contract audit or professional application security review. No public mainnet deployment or broadcast is authorized.

---

## 1. Executive Summary & Deliverables

In Sprint 5 Stage 2, CertProof completed the containerization, packaging, deployment identity validation, and acceptance preparation workflows required to transition the remediated Next.js 15 / Foundry stack into a reproducible local and staging deployment environment.

### 1.1 Core Deliverables Matrix

| Area | Component | Implementation / Artifact | Verification Status |
| :--- | :--- | :--- | :---: |
| **Packaging** | Multi-Stage Dockerfile | [`Dockerfile`](file:///Volumes/D%20Disc/WEB3/CertProof/Dockerfile) (Node 20 Alpine, non-root user `nextjs:1001`, Next.js standalone output, Web Worker assets) | **PASSED** (Built & exercised in smoke test) |
| **Orchestration** | Scoped Compose Setup | [`docker-compose.yml`](file:///Volumes/D%20Disc/WEB3/CertProof/docker-compose.yml) (Next.js app, authenticated MongoDB 7.0, optional local Anvil profile, private network, loopback bindings) | **PASSED** (All services healthy) |
| **Indexes** | Idempotent DB Initialization | [`scripts/mongo-init-indexes.js`](file:///Volumes/D%20Disc/WEB3/CertProof/scripts/mongo-init-indexes.js) (Unique nonce index, TTL indexes, session token hashes) | **PASSED** (Verified in MongoDB) |
| **Identity** | Deployment Manifest Verification | [`scripts/verify-deployment-manifest.mjs`](file:///Volumes/D%20Disc/WEB3/CertProof/scripts/verify-deployment-manifest.mjs) & [`deployments/`](file:///Volumes/D%20Disc/WEB3/CertProof/deployments/) | **PASSED** (Schema, chain ID & bytecode hash validated) |
| **Security** | Reverse Proxy Trust & Rate Limiting | [`frontend/src/lib/auth/ip.ts`](file:///Volumes/D%20Disc/WEB3/CertProof/frontend/src/lib/auth/ip.ts), [`deploy/nginx/nginx.conf`](file:///Volumes/D%20Disc/WEB3/CertProof/deploy/nginx/nginx.conf), [`frontend/test/ip-trust-rate-limit.test.ts`](file:///Volumes/D%20Disc/WEB3/CertProof/frontend/test/ip-trust-rate-limit.test.ts) | **PASSED** (8/8 unit tests passed) |
| **Smoke Test** | Repeatable Bounded Package Test | [`scripts/smoke-test-package.mjs`](file:///Volumes/D%20Disc/WEB3/CertProof/scripts/smoke-test-package.mjs) (Isolated compose project `certproof-smoke`, 10 automated phases) | **PASSED** (10/10 phases passed) |
| **Acceptance** | Interactive Wallet Acceptance Guide | [`docs/manual-wallet-acceptance.md`](file:///Volumes/D%20Disc/WEB3/CertProof/docs/manual-wallet-acceptance.md) | **DOCUMENTED** (Manual extension runs marked PENDING) |
| **Documentation** | Root Project Guide | [`README.md`](file:///Volumes/D%20Disc/WEB3/CertProof/README.md) | **COMPLETED** |

---

## 2. Reproducible Docker Setup & Configuration Architecture

### 2.1 Multi-Stage Dockerfile
- **Base Image:** `node:20-alpine` (matches local host toolchain Node.js v20.20.2).
- **Stage 1 (`deps`):** Clean reproducible installation via `npm ci` referencing `frontend/package-lock.json`.
- **Stage 2 (`builder`):** Compiles Next.js standalone application (`npm run build`). Web Worker chunks and client bundles are compiled into `.next/static`. Telemetry disabled.
- **Stage 3 (`runner`):** Minimal production image executing as non-root user `nextjs` (UID 1001, GID 1001). Copies standalone output and static assets. Health check verifies `/api/auth/session` readiness via `wget`.
- **Build-Time vs. Runtime Decoupling:**
  - Build-time embedded variables: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_REGISTRY_ADDRESS`, `NEXT_PUBLIC_ANVIL_RPC_URL`, `NEXT_PUBLIC_SEPOLIA_RPC_URL`.
  - Runtime server variables: `MONGODB_URI`, `SESSION_SECRET`, `TRUST_PROXY`, `SERVER_RPC_URL`, `COOKIE_SECURE`. Image builds require **zero** running database or RPC connectivity.
- **Context Hygiene:** `.dockerignore` strictly excludes `.env`, `*.local`, private keys, contracts, tests, and temporary fixtures.

### 2.2 Scoped Docker Compose Architecture
- **Web Service (`web`):** Next.js production container bound to loopback `127.0.0.1:3010`.
- **Database Service (`mongodb`):** MongoDB 7.0 document store on private bridge network `certproof_net`. Requires root credentials (`MONGO_INITDB_ROOT_USERNAME`, `MONGO_INITDB_ROOT_PASSWORD`). Exposes `127.0.0.1:27017` to loopback only.
- **Consensus Service (`anvil`):** Optional local Foundry consensus node under profile `local-anvil` (`--profile local-anvil`), exposing `127.0.0.1:8545`.
- **Data Persistence:** Persistent named volumes `mongo_data` and `anvil_data` preserve application data and chain state across normal `docker compose stop` or `docker compose down`.
- **Idempotent Indexes:** Database indexes are automatically created via `/docker-entrypoint-initdb.d/01-indexes.js` and verified at runtime:
  - `siwe_challenges`: Unique index on `nonce`, TTL index on `expiresAt` (`expireAfterSeconds: 0`).
  - `sessions`: Unique index on `sessionTokenHash`, index on `walletAddress`, TTL index on `expiresAt` (`expireAfterSeconds: 0`).

---

## 3. Reverse Proxy & Client IP Trust Hardening

### 3.1 Security Review & Threat Model
1. **Header Spoofing Prevention:**  
   Clients can trivially inject arbitrary `X-Forwarded-For` or `X-Real-IP` HTTP headers. Under the default configuration (`TRUST_PROXY=false`), the application strictly ignores these headers and returns a static bucket identifier (`'untrusted-client'`). This prevents attackers from bypassing rate limits by rotating fake IP addresses.
2. **Safe Fallback:**  
   When `TRUST_PROXY=true`, the application validates the IP address syntax using Node's `net.isIP`. If the forwarded IP is malformed or absent, it falls back to `'proxy-fallback'` rather than generating memory allocations from untrusted strings.
3. **Perimeter Proxy Guarantees:**  
   [`deploy/nginx/nginx.conf`](file:///Volumes/D%20Disc/WEB3/CertProof/deploy/nginx/nginx.conf) strips all incoming client forwarding headers and replaces them with the verified TCP remote address (`$remote_addr`):
   ```nginx
   proxy_set_header X-Real-IP $remote_addr;
   proxy_set_header X-Forwarded-For $remote_addr;
   proxy_set_header X-Forwarded-Proto $scheme;
   ```
4. **Single-Instance Limitation:**  
   The in-memory rate limiter operates per-process. In a horizontally scaled cluster, rate limiting must be enforced at the reverse proxy ingress (e.g. Nginx `limit_req_zone` or Cloudflare WAF).

---

## 4. Bounded Package Smoke Test Results

The package smoke test ([`scripts/smoke-test-package.mjs`](file:///Volumes/D%20Disc/WEB3/CertProof/scripts/smoke-test-package.mjs)) was executed using an isolated Docker Compose project name (`certproof-smoke`), dedicated ports (`3199`, `27199`, `8599`), disposable credentials, and ephemeral volumes.

### 4.1 Phase Execution Results

```
===============================================================
 CertProof Sprint 5 Stage 2 — Bounded Package Smoke Test
===============================================================
Isolated Compose Project: certproof-smoke
Application Port: 3199
MongoDB Port: 27199

[Phase 1] Building and launching isolated smoke test containers...
  ✓ Multi-stage Docker build succeeded (certproof:local)
  ✓ MongoDB container healthy (port 27199)
  ✓ Web container healthy (port 3199)
  ✓ Production container is healthy and responding.

[Phase 2] Verifying idempotent MongoDB indexes...
  - Challenges unique nonce index: PASS
  - Challenges TTL expiresAt index: PASS
  - Sessions unique token index: PASS
  - Sessions walletAddress index: PASS
  - Sessions TTL expiresAt index: PASS
[Phase 2] Required database indexes verified.

[Phase 3] Testing public verification route without authentication...
  ✓ /verify/<certId> returned HTTP 200 with zero auth requirements.

[Phase 4] Testing production static assets and Web Worker chunk loading...
  ✓ Successfully verified 14 production chunks (including Web Worker bundles) returned HTTP 200 with application/javascript.

[Phase 5] Testing QR generation dependency in production container...
  ✓ QR Code generation verified successfully (data:image/png;base64,...).

[Phase 6] Testing RPC outage vs Missing Deployment state distinction...
  - RPC outage state verified: HTTP 503 RPC_ERROR
  - Launching scoped Anvil profile container...
  - Missing deployment state verified distinct from RPC outage: HTTP 200 MISSING_DEPLOYMENT

[Phase 7] Testing public verification while MongoDB is stopped...
  ✓ Public verification operates cleanly while MongoDB is unavailable (HTTP 200).

[Phase 8] Testing auth endpoint failure reporting while MongoDB is unavailable...
  ✓ Auth endpoints report database failure gracefully without hanging (HTTP 500).

[Phase 9] Testing persistent volume data preservation across stop/restart...
  - Stopping containers...
  - Starting containers back up...
  ✓ Database records survived container restart intact.

[Phase 10] Verifying deployment manifests were not overwritten or mutated...
  ✓ deployments/local-anvil.json preserved byte-for-byte.

===============================================================
 ✔ ALL 10 SMOKE TEST PHASES PASSED SUCCESSFULLY
===============================================================

[Teardown] Cleaning up isolated smoke test containers and disposable volume...
[Teardown] Disposable smoke-test resources removed cleanly.
```

---

## 5. Automated Verification Summary

All verification suites were executed against the code changes and packaging configurations:

| Test Suite | Command | Result | Details |
| :--- | :--- | :---: | :--- |
| **Package Smoke Test** | `npm run smoke:package` | **PASS (10/10)** | Multi-stage Docker, indexes, persistence, outages, Web Worker chunks. |
| **Manifest Verification** | `npm run verify:manifest` | **PASS** | Validates local-anvil.json and sepolia.example.json schemas and bytecode. |
| **Smart Contract Tests** | `npm run test` | **PASS (38/38)** | 33 unit tests, 4 fuzz tests, 1 stateful invariant suite (2048 calls, 0 reverts). |
| **Frontend Unit & Anvil Integration** | `npm run web:test` | **PASS (150/150)** | 19 test files passed cleanly (including IP trust, SIWE, recovery, and Anvil). |
| **Real-Browser Playwright E2E** | `npm run test:browser` | **PASS (8/8)** | Chrome 156 exercising Web Worker zero-upload hashing and QR modal. |
| **Type Check** | `cd frontend && npx tsc --noEmit` | **PASS (0 errors)** | Full TypeScript static analysis passed. |
| **ESLint Check** | `cd frontend && npm run lint` | **PASS (0 errors)** | No warnings or errors. |
| **Dependency Audit** | `npm audit` (Root & Frontend) | **PASS (0 vulns)** | 0 vulnerabilities across all production and development trees. |

---

## 6. Interactive Wallet Acceptance Status & Blockers

Manual acceptance procedures are detailed in [`docs/manual-wallet-acceptance.md`](file:///Volumes/D%20Disc/WEB3/CertProof/docs/manual-wallet-acceptance.md).

### 6.1 Status of Interactive Checks
- **Interactive Injected Wallet Flows:** **PENDING**  
  **Exact Blocker:** Automated CI and CLI agent environments run non-interactively without an attached human operator to interact with browser extension prompt windows (e.g. MetaMask popup confirmations, physical signature approvals, and mobile camera QR scanning). Per task requirements, simulated Viem clients or headless scripts do not substitute for authentic interactive extension acceptance.
- **Readiness:** All interactive prerequisites (step-by-step test instructions, pre-funded disposable Anvil accounts, and error assertion steps) are fully prepared and documented.

---

## 7. Cleanup & Resource State

- **Smoke Test Resources:** All disposable smoke test containers (`certproof-smoke-*`), networks, and volumes were destroyed during smoke test teardown.
- **Running Processes:** All background tasks, test Anvil instances, and temporary servers started during verification were stopped.
- **Unrelated Resources:** Pre-existing Docker containers on the host were inspected and left untouched.
- **Repository State:** Clean; deployment manifests, contracts, and lockfiles preserved without mutation.
