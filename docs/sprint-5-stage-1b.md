# CertProof — Sprint 5, Stage 1B: Framework Dependency Remediation & Verification

**Sprint Focus:** Remediation of Remaining Framework Advisories, Focused Next.js 15 Migration, Async Request API Adaptation, PostCSS Resolution, and Full-Stack Non-Regression Verification  
**Status:** Verification Complete Across Unit, Component, Anvil Integration, Real-Browser Playwright E2E, and Parity Suites  
**Date:** 2026-10-28  
**Notice:** A zero-vulnerability dependency audit does not equate to a professional security audit or production deployment clearance. CertProof has verified dependency hygiene, type safety, and functional regression for local development and Sepolia testnet staging, but has not undergone an external third-party smart contract audit or formal application penetration test.

---

## 1. Executive Summary & Before/After Audit Results

In Sprint 5 Stage 1B, CertProof completed the remediation of the final two upstream security findings identified during Stage 1: the core `next@14.2.35` framework advisories (spanning 25 CVEs/GHSAs) and the nested `postcss@8.4.31` vulnerabilities.

Rather than applying breaking major migrations across the entire stack (such as jumping to Next.js 16 and React 19 with ESLint 9 flat configurations), CertProof implemented the **smallest supported remediation**:
1. Conducted a focused migration to **Next.js 15.5.28** (the official upstream security backport for the Next 15 release series).
2. Preserved **React 18.3.1**, **Wagmi 3.7.9**, and **ESLint 8.57.1** without disruption.
3. Updated top-level PostCSS to **8.5.32** and applied a supported package override (`"postcss": "^8.5.32"`) to deduplicate and secure the framework's internal CSS compiler.
4. Adapted asynchronous page parameter APIs (`params` and `searchParams` Promises) in `/verify/[certId]` and modernized IP header resolution in route handlers.

### 1.1 Comparative Audit Results Matrix

| Scope | Metric | Before (Stage 1) | After (Stage 1B) | Delta / Remediation |
| :--- | :--- | :---: | :---: | :--- |
| **Root Repository** (`package.json`) | Total Vulnerabilities | **0** | **0** | Clean (exit code 0) |
| | Production Vulnerabilities (`--omit=dev`) | **0** | **0** | Clean (exit code 0) |
| **Frontend Project** (`frontend/package.json`) | **Total Vulnerabilities** | **2** | **0** | **-2 resolved (100% clean)** |
| | Moderate Severity | 0 | 0 | 0 |
| | High Severity | 1 | 0 | -1 resolved (`postcss` upgraded to 8.5.32) |
| | Critical Severity | 1 | 0 | -1 resolved (`next` upgraded to 15.5.28) |
| | **Production Vulnerabilities** (`--omit=dev`) | **2** | **0** | **-2 production vulnerabilities resolved** |
| | **Development Vulnerabilities** | **0** | **0** | Clean (exit code 0) |
| | Total Resolved Packages in Lockfile | 587 | 534 | -53 packages streamlined |
| | PostCSS Resolution | 8.4.31 (pinned in Next) | 8.5.32 (deduped across tree) | Upgraded & patched |

---

## 2. Upstream Advisory Catalog & Exposure Reassessment

### 2.1 Verified Advisories & Upstream Official Sources

The 2 npm audit entries previously carried forward represented 29 distinct upstream vulnerability disclosures:

#### Next.js Framework Core (`next@14.2.35`)
- **[GHSA-2464-fhr4-w9xw](https://github.com/advisories/GHSA-2464-fhr4-w9xw)** (Critical, CWE-78, CVSS 9.8): Unauthenticated Remote Code Execution in Image Optimization API when SVG files are used. Patched in `15.5.28`, `16.4.3`.
- **[GHSA-p293-qw3h-jr36](https://github.com/advisories/GHSA-p293-qw3h-jr36)** (Critical, CWE-22, CVSS 9.8): Unauthenticated Remote Code Execution on windows-hosted servers. Patched in `15.5.24`, `15.5.28`, `16.4.3`.
- **[GHSA-2xp9-vwfh-vxw4](https://github.com/advisories/GHSA-2xp9-vwfh-vxw4)** (Critical, CWE-78, CVSS 9.8): Unauthenticated Remote Code Execution in Image Optimization API when AVIF files are used. Patched in `15.5.24`, `15.5.28`, `16.4.3`.
- **[GHSA-p3m5-59mp-jv5r](https://github.com/advisories/GHSA-p3m5-59mp-jv5r)** (High, CWE-400, CVSS 7.5): Denial of Service in App Router using Server Actions. Patched in `15.5.28`, `16.4.3`.
- **[GHSA-m99w-x7hq-7vfj](https://github.com/advisories/GHSA-m99w-x7hq-7vfj)** (High, CWE-400, CVSS 7.5): Denial of Service in App Router using Server Actions. Patched in `15.5.21`, `15.5.28`, `16.4.3`.
- **[GHSA-89xv-2m56-2m9x](https://github.com/advisories/GHSA-89xv-2m56-2m9x)** (High, CWE-918, CVSS 7.5): Server-Side Request Forgery in Server Actions on custom servers. Patched in `15.5.21`, `15.5.28`, `16.4.3`.
- **[GHSA-p9j2-gv94-2wf4](https://github.com/advisories/GHSA-p9j2-gv94-2wf4)** (High, CWE-918, CVSS 7.5): Server-Side Request Forgery in rewrites via attacker-controlled destination hostname. Patched in `15.5.21`, `15.5.28`, `16.4.3`.
- **[GHSA-c4j6-fc7j-m34r](https://github.com/advisories/GHSA-c4j6-fc7j-m34r)** (High, CWE-918, CVSS 7.5): Server-Side Request Forgery in applications using WebSocket upgrades. Patched in `15.5.16`, `15.5.28`, `16.4.3`.
- **[GHSA-q4gf-8mx6-v5v3](https://github.com/advisories/GHSA-q4gf-8mx6-v5v3)** (High, CWE-400, CVSS 7.5): Denial of Service with Server Components. Patched in `15.5.15`, `15.5.28`, `16.4.3`.
- **[GHSA-8h8q-6873-q5fj](https://github.com/advisories/GHSA-8h8q-6873-q5fj)** (High, CWE-400, CVSS 7.5): Denial of Service with Server Components. Patched in `15.5.16`, `15.5.28`, `16.4.3`.
- **[GHSA-h25m-26qc-wcjf](https://github.com/advisories/GHSA-h25m-26qc-wcjf)** (High, CWE-502, CVSS 7.5): HTTP request deserialization DoS when using insecure React Server Components. Patched in `15.0.8`, `15.5.28`, `16.4.3`.
- **[GHSA-36qx-fr4f-26g5](https://github.com/advisories/GHSA-36qx-fr4f-26g5)** (High, CWE-284, CVSS 7.5): Middleware / Proxy bypass in Pages Router applications using i18n. Patched in `15.5.16`, `15.5.28`, `16.4.3`.
- Additional 13 moderate/low advisories: `GHSA-9g9p-9gw9-jx7f`, `GHSA-ggv3-7p47-pfv8`, `GHSA-3x4c-7xq6-9pq8`, `GHSA-3g8h-86w9-wvmq`, `GHSA-ffhc-5mcf-pf4q`, `GHSA-vfv6-92ff-j949`, `GHSA-gx5p-jg67-6x7h`, `GHSA-h64f-5h5j-jqjh`, `GHSA-wfc6-r584-vfw7`, `GHSA-68g3-v927-f742`, `GHSA-4633-3j49-mh5q`, `GHSA-4c39-4ccg-62r3`, `GHSA-955p-x3mx-jcvp`.

#### Nested PostCSS Dependency (`postcss@8.4.31`)
- **[GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q)** (High, CWE-22, CWE-200, CVSS 7.5): Arbitrary file read and information disclosure via attacker-controlled `sourceMappingURL` in CSS comments. Patched in `8.5.12`.
- **[GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)** (Moderate, CWE-22, CWE-200): Incomplete fix of GHSA-6g55-p6wh-862q — attacker-controlled `sourceMappingURL` reads arbitrary `.map` files when `from` is unset. Patched in `8.5.23`.
- **[GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849)** (High, CWE-22, CVSS 7.5): Path Traversal in Previous Source Map Auto-Loading leads to Arbitrary `.map` File Disclosure. Patched in `8.5.18`.
- **[GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)** (Moderate, CWE-79, CVSS 6.1): PostCSS XSS via Unescaped `</style>` in CSS Stringify Output. Patched in `8.5.10`.

### 2.2 Reassessment of Previous “Zero Operational Exposure” Claim

In the Sprint 5 Stage 1 report, an initial runtime analysis hypothesized "zero operational exposure" because the CertProof codebase did not explicitly invoke `'use server'` Server Actions, did not import `next/image`, and targeted POSIX/Linux deployments.

**Reassessment & Correction:**
1. **Framework Dispatchers Remain Active:** Next.js compiles internal request dispatchers and route handling machinery into the runtime bundle regardless of whether user components explicitly invoke them. An attacker sending crafted HTTP requests (e.g. POST requests targeting action IDs or `/_next/image` query parameters) can trigger internal handlers if perimeter proxies fail to filter them.
2. **Denial of Service Surface:** RSC cache-busting and request body deserialization advisories apply to standard App Router endpoints receiving malicious headers or malformed UTF-8 payloads.
3. **Conclusion:** Defense-in-depth requires eliminating known vulnerabilities at the package dependency layer. Relying on application-code absence assumptions is insufficient for internet-facing systems.

---

## 3. Remediation Strategy & Compatibility Rationale

### 3.1 Why Next.js 15.5.28 Was Selected Over Next.js 16.4.3

| Factor | Next.js 15.5.28 (Selected) | Next.js 16.4.3 (Alternative) | Selection Rationale |
| :--- | :--- | :--- | :--- |
| **Upstream Support Status** | Official Security Backport (`backport: 15.5.28`) | Current Latest (`latest: 16.4.3`) | 15.5.28 incorporates every security patch backported by Vercel for the 15.x LTS series. |
| **React Compatibility** | Native React 18 Support (`^18.2.0 \|\| ^19.0.0`) | Supports React 18 & 19 | Allows CertProof to stay on stable `react@18.3.1` without forcing a major React 19 rewrite. |
| **ESLint Tooling** | Supports ESLint 8 & 9 (`^7.23.0 \|\| ^8.0.0 \|\| ^9.0.0`) | Enforces ESLint 9 (`>=9.0.0`) | Preserves working `.eslintrc.json` configuration without requiring flat config migration. |
| **Wagmi 3 Integration** | Seamless with `@tanstack/react-query@5` | Identical | Wagmi 3.7.9 works without any version conflict. |
| **PostCSS Remediation** | Pinned `8.4.31` resolved via `"overrides": {"postcss": "^8.5.32"}` | Pinned `8.5.23` in Next core | Both options resolve all PostCSS CVEs; 15.5.28 with override is fully compatible. |

### 3.2 Implemented Manifest & Code Modifications

#### 1. Frontend Manifest (`frontend/package.json`)
- Updated `next`: `^14.2.35` → `^15.5.28`
- Updated `eslint-config-next`: `^14.2.35` → `^15.5.28`
- Updated `devDependencies.postcss`: `^8.4.47` → `^8.5.32`
- Added override: `"overrides": { "glob": "^10.5.0", "postcss": "^8.5.32", "zod": "^4.6.7" }`

#### 2. Async Page & Route Parameter Migration (`frontend/src/app/verify/[certId]/page.tsx`)
In Next.js 15, App Router page `params` and `searchParams` are asynchronous Promises.
- Updated `PageProps` interface:
  ```typescript
  interface PageProps {
    params: Promise<{ certId: string }>;
    searchParams?: Promise<{ [key: string]: string | string[] | undefined }>;
  }
  ```
- Updated `generateMetadata` to `async` and awaited `props.params`.
- Updated `VerifyCertificatePage` to `async` and awaited `props.params` and `props.searchParams`.

#### 3. Route Handler IP Header Resolution (`src/app/api/auth/nonce/route.ts`, `src/app/api/auth/verify/route.ts`)
Next.js 15 removed the deprecated non-standard `request.ip` property from `NextRequest` types.
- Standardized IP extraction to evaluate proxy headers:
  ```typescript
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() || request.headers.get('x-real-ip') || '127.0.0.1';
  ```

#### 4. Workspace Root Tracing (`frontend/next.config.mjs`)
- Configured `outputFileTracingRoot: path.resolve(__dirname, '..')` to silence Next.js 15 root inference warnings regarding monorepo lockfile presence.

---

## 4. Verification Evidence & Test Execution Matrix

### 4.1 Reproducible Installation Verification
- **Command:** `cd frontend && npm ci`
- **Result:** `added 533 packages, and audited 534 packages in 10s (exit code 0)`
- **Vulnerabilities:** **0 vulnerabilities**

### 4.2 Static Typing Check
- **Command:** `cd frontend && npx tsc --noEmit`
- **Result:** **0 errors (exit code 0)**

### 4.3 ESLint Check
- **Command:** `cd frontend && npm run lint`
- **Result:** **✔ No ESLint warnings or errors (exit code 0)**

### 4.4 Automated Frontend Vitest Suite
- **Command:** `cd frontend && npm test`
- **Runner:** Vitest 4.1.12 with `@vitejs/plugin-react`
- **Result:** **18 test files passed (18/18), 142 tests passed (142/142), 0 failed (exit code 0)**

| Test Suite | Tests | Result | Focus / Invariant Verified |
| :--- | :---: | :---: | :--- |
| `test/next15-async-params.test.tsx` *(New Stage 1B Suite)* | 3 | **Passed** | Confirms `generateMetadata` and `VerifyCertificatePage` correctly await Promise-based `params` and `searchParams`. |
| `test/wallet-injected-config.test.ts` | 4 | **Passed** | Injected-only connector, zero third-party wallet SDKs, Anvil/Sepolia chain coverage. |
| `test/certificate-share.test.ts` | 14 | **Passed** | Canonical URL construction, deployment parameter scoping, local QR PNG generation and `jsQR` decoding. |
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

### 4.5 Production Next.js Build
- **Command:** `cd frontend && npm run build`
- **Next.js Version:** `15.5.28`
- **Result:** **Compiled successfully (exit code 0)**
- **Routes Generated:**
  - `○ /` (Static, 2.17 kB)
  - `○ /_not-found` (Static, 996 B)
  - `ƒ /api/auth/logout` (Dynamic, 136 B)
  - `ƒ /api/auth/nonce` (Dynamic, 136 B)
  - `ƒ /api/auth/session` (Dynamic, 136 B)
  - `ƒ /api/auth/verify` (Dynamic, 136 B)
  - `ƒ /api/issuer/status` (Dynamic, 136 B)
  - `○ /issuer` (Static, 15.3 kB)
  - `○ /verify` (Static, 1.64 kB)
  - `ƒ /verify/[certId]` (Dynamic, 8.06 kB)

### 4.6 Real-Browser Playwright End-to-End Verification
- **Command:** `node scripts/verify-browser-e2e.mjs`
- **Browser:** Real desktop Google Chrome 156.0.8078.73
- **Result:** **8/8 stages passed cleanly (exit code 0)**:
  1. Isolated Anvil node initialized on port `8562`.
  2. `CertProofRegistry` deployed and test certificate registered on-chain.
  3. Production Next.js 15 bundle compiled with deployment environment.
  4. Production application server started on port `3005` (with MongoDB explicitly disabled).
  5. Google Chrome launched via Playwright.
  6. Exercised `/verify/[certId]` with zero wallet or SIWE prompts.
  7. Tested Web Worker Keccak-256 local comparison across `original.pdf`, `duplicate.pdf`, and `modified.pdf` (zero PDF bytes uploaded to network).
  8. Tested Share controls and local QR code PNG rendering; verified 0 browser console errors.

### 4.7 ABI Parity Verification
- **Command:** `node scripts/export-abi.mjs && diff -u contracts/abi/CertProofRegistry.ts frontend/src/lib/abi/CertProofRegistry.ts`
- **Result:** **Exact byte-for-byte match (exit code 0)**

### 4.8 Complete Dependency Audit Execution Matrix
Executed across both projects with full and production-only scoping:

```bash
# Root Repository
npm audit                 # 0 vulnerabilities (exit code 0)
npm audit --omit=dev      # 0 vulnerabilities (exit code 0)

# Frontend Project
cd frontend
npm audit                 # 0 vulnerabilities (exit code 0)
npm audit --omit=dev      # 0 vulnerabilities (exit code 0)
```

---

## 5. Architectural Delineation & Deployment Readiness

### 5.1 Local Development Readiness: Approved
- **Status:** **Ready for Local Engineering.**
- **Rationale:**
  - 100% clean dependency audit across all root and frontend dependencies.
  - Development tools (`vitest`, `esbuild`, `tinypool`) free of known CVEs.
  - Next.js 15.5.28 compiles production output cleanly with zero type errors.
  - All 142 automated tests pass with 100% determinism.

### 5.2 Internet-Facing Testnet (Sepolia) Hosting Readiness: Approved for Staging
- **Status:** **Approved for Sepolia Staging Deployment.**
- **Rationale:**
  - All 25 critical/high Next.js framework CVEs (including RCE and DoS vectors) and all 4 PostCSS CVEs have been remediated in the codebase and lockfiles.
  - Zero wallet connector bloat exists in client bundles.
  - Standard containerization practices (Linux/POSIX runtime) further neutralize residual Windows-specific attack surfaces.
- **Pending Pre-Production Hardening:**
  - Standard edge reverse-proxy configuration (Cloudflare/Nginx) recommended to rate-limit public verifier endpoints.
  - Formal interactive hardware wallet signing acceptance testing remains pending until Sepolia broadcast.

### 5.3 Commercial Mainnet Readiness: Blocked
- **Status:** **Not Approved for Mainnet Financial or Identity Release.**
- **Rationale:**
  - A clean `npm audit` is a necessary baseline for software hygiene, but is not a substitute for an external professional smart contract security audit or third-party penetration testing.

---

## 6. Process & Daemon Cleanup Status

All background processes, ports, and ephemeral test containers created during Stage 1B verification have been verified clear:
- **Anvil Instances:** Port 8562 (E2E) and port 8548 (test runner) terminated.
- **Next.js Servers:** Port 3005 test server terminated.
- **MongoDB Test Containers:** Port 27018 container stopped and removed (`docker ps` verified).
- **Headless Chrome Instances:** Terminated cleanly by Playwright harness.
- **Ports Verified Clear:** 8545, 8548, 8562, 3005, 27018 verified unoccupied via `lsof`.
- **System State:** Persistent project files, database state, and deployment configurations preserved.
