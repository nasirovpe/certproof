# CertProof — Product Specification (Sprint 1)

## 1. Executive Summary & Vision

**CertProof** is an open-source, decentralized verification system designed to register and verify digital credentials (such as diplomas, certificates, and licenses) as cryptographic document hashes on the Ethereum blockchain.

Traditional digital credentials suffer from two opposing failure modes:
1. **Centralized silos:** Verification depends on proprietary institutional portals, vendor lock-in, or ephemeral web services that disappear when institutions change platforms or close.
2. **Naive blockchain implementations:** Systems often inappropriately store personally identifiable information (PII) on public ledgers, mandate that students own crypto wallets, or package certificates as speculative Non-Fungible Tokens (NFTs).

CertProof resolves these flaws through a **privacy-first, credential-agnostic verification architecture**:
- **Issuers** compute cryptographic digests of existing certificate PDF files locally in the browser and anchor the hash to Ethereum.
- **Recipients** receive an unaltered PDF document along with an opaque verification link or QR code. They never need a crypto wallet, gas tokens, or blockchain technical knowledge.
- **Verifiers** (employers, regulators, academic institutions) inspect the public record for free. By selecting the candidate PDF locally in their browser, the verifier computes its hash client-side and validates whether the document bytes match the immutable on-chain registration.

---

## 2. Project Boundaries & MilestonePay Separation

CertProof is developed within the active workspace `/Volumes/D Disc/WEB3/CertProof`. To preserve architectural autonomy and avoid licensing, security, and state contamination:

1. **Strict Repository Isolation:** CertProof maintains zero coupling to MilestonePay (`Freelancer Escrow`). No directories, build artifacts, secrets, database instances, chain deployments, or environment variables are shared.
2. **Architectural Cross-Pollination Boundaries:** While battle-tested patterns from MilestonePay (such as Sign-In with Ethereum [SIWE] session validation and viem/wagmi contract bindings) provide design references, all CertProof implementations must be written from scratch, adhering to CertProof's specific permission matrices, data privacy boundaries, and threat model.
3. **No Cross-Contamination of Chain State:** All contracts and test environments for CertProof operate independently on dedicated local Anvil networks and Ethereum Sepolia testnet contracts.

---

## 3. User Personas

| Persona | Technical Background | Primary Objectives | Key Constraints & Pain Points |
| :--- | :--- | :--- | :--- |
| **Registry Administrator** | High (Web3 native) | • Deploy and maintain the registry contract.<br>• Authorize legitimate issuer addresses.<br>• De-authorize compromised or retired issuers. | • Must not possess unilateral power to alter or censor historical certificate records.<br>• Minimal operational overhead. |
| **Authorized Issuer** (e.g., University Registrar, Training Institute, Certification Body) | Medium (Web3 familiar) | • Authenticate securely with an institutional wallet.<br>• Register batches or individual certificate hashes.<br>• Manage issued records and execute permanent revocations if credentials are invalidated. | • Zero tolerance for student data leaks.<br>• Fast, predictable workflow without complex PDF redesign.<br>• Cannot afford high gas fees or cumbersome transaction recovery. |
| **Certificate Recipient** (e.g., Student, Professional) | Low (Non-crypto user) | • Receive standard PDF credential.<br>• Share verification link or QR code on resumes/LinkedIn. | • **Must never be forced to hold a wallet, pay gas, or maintain private keys.** |
| **Public Verifier** (e.g., Hiring Manager, Background Screener) | Low (Non-crypto user) | • Instantly verify whether a received PDF matches the registered record.<br>• Check whether the certificate is revoked or the issuer was de-authorized. | • **No account creation or wallet required.**<br>• Instant verification feedback.<br>• Plain-language explanation of verification status. |

---

## 4. MVP Scope Boundaries

### 4.1 In-Scope (Sprint 1–5 Roadmap)
- **Issuer Wallet Authentication:** SIWE (EIP-4361) with MongoDB server-side session authentication and role checking (scheduled for Sprint 3; not implemented in Sprint 2).
- **Client-Side Document Hashing:** Local cryptographic hashing (Keccak-256) of raw PDF bytes entirely within the browser.
- **On-Chain Document Anchoring:** Ethereum smart contract registering opaque certificate IDs, document hashes (`bytes32`), issuer addresses, and block timestamps.
- **Uniqueness & Deduplication Enforcement:** Enforcing unique registration per `(issuer, documentHash)` tuple while allowing independent issuers to register identical files if needed.
- **Permanent Revocation:** Cryptographic and on-chain revocation mechanism callable solely by the original issuing address.
- **Public Verification Portal:** Zero-auth public web page accepting certificate IDs via URL path.
- **Local File Comparison Engine:** Drag-and-drop client-side PDF verification comparing local hash against on-chain state without uploading the file.
- **Shareable Artifacts:** Auto-generated direct verification URLs and standards-compliant QR codes containing the URL.
- **Minimal Issuer Dashboard:** Paginated view of certificates issued by the connected wallet, displaying registration status, timestamps, and revocation controls.
- **Minimal Issuer Metadata:** Off-chain MongoDB storage for institutional display names and public contact links associated with issuer wallet addresses.

### 4.2 Explicitly Out-of-Scope (Non-Goals)
- **NFT Minting:** No ERC-721 or ERC-1155 tokenization. Certificates are not tradable or transferable assets.
- **PDF Generation & Design:** The application will not design, render, format, or generate PDF files. Issuers use their existing credential generation tools.
- **Cryptographic PDF Signatures (CAdES/PAdES):** Does not parse or validate internal X.509 Adobe digital signatures within the PDF container.
- **Payments & Metering:** No protocol fees, escrow mechanisms, or credit card billing in the MVP.
- **Student Wallet Ingress:** Recipients do not claim, hold, or sign for certificates.
- **Public Document Storage:** The platform **never** stores, hosts, mirrors, or pins certificate PDFs on central servers, S3, IPFS, or Arweave.
- **Multi-Organization Governance / Multi-Sig UI:** Contract administration relies on standard Safe/EVM multisig at the protocol level, not an in-app governance portal.
- **In-Place Certificate Modification:** Registered hashes and metadata are immutable. Corrections require revoking the erroneous record and issuing a new one.
- **Claims of Academic Accreditation:** The system does not certify that an issuer is an accredited educational body or that the course content meets pedagogical standards.

---

## 5. Precise Definitions of Verification Outcomes

A central flaw of many verification systems is reducing complex state into a single ambiguous "Valid / Invalid" badge. CertProof strictly decouples verification into **four independent operational facts**:

1. **Registration Existence:** Does an immutable certificate record exist on-chain for the given `certId`?
2. **File Hash Match:** Does the candidate PDF's locally computed Keccak-256 hash match the on-chain `documentHash`? (States: `MATCH`, `MISMATCH`, or `UNCHECKED_NO_FILE`).
3. **Certificate Revocation:** Has the certificate been permanently revoked on-chain by its original issuer? (`ACTIVE` vs. `REVOKED`).
4. **Current Issuer Authorization:** Is the original issuing wallet address currently authorized by the registry administrator? (`AUTHORIZED` vs. `DEAUTHORIZED`).

These facts are orthogonal. In particular:
- **Revoked & De-authorized:** A certificate can be both permanently revoked AND issued by a currently de-authorized issuer.
- **Link Access is Not Document Verification:** Opening `https://certproof.app/verify/<id>` without selecting a local file reads the public on-chain record, but the document hash status remains strictly `UNCHECKED_NO_FILE`. Opening a verification link must **never** imply or present that the PDF was checked or authentic.

### 5.1 Independent Verification Facts Matrix

| Verification Dimension | Possible Values | Meaning & Verifier Presentation |
| :--- | :--- | :--- |
| **1. Registration Existence** | `EXISTS`<br>`NOT_FOUND` | `EXISTS`: An on-chain record exists with a non-zero registration timestamp.<br>`NOT_FOUND`: The certificate ID has never been registered on-chain. |
| **2. Document Hash Match** | `MATCH`<br>`MISMATCH`<br>`UNCHECKED_NO_FILE` | `MATCH`: In-memory Keccak-256 hash of selected local file matches registered hash.<br>`MISMATCH`: Hash differs; document has been altered or a wrong file was selected.<br>`UNCHECKED_NO_FILE`: No file has been selected yet; file bytes have NOT been checked. |
| **3. Certificate Revocation** | `ACTIVE`<br>`REVOKED` | `ACTIVE`: The original issuer has not revoked this certificate (`revoked == false`).<br>`REVOKED`: The original issuer permanently revoked this certificate (`revoked == true`). |
| **4. Current Issuer Authorization** | `AUTHORIZED`<br>`DEAUTHORIZED` | `AUTHORIZED`: The original issuer address is currently authorized by registry admin.<br>`DEAUTHORIZED`: The original issuer address is currently de-authorized by registry admin. |

### 5.2 Compound Status Presentation Examples

Because the dimensions are independent, the verifier UI reports each dimension clearly:
- **Active & Validated:** `EXISTS` + `MATCH` + `ACTIVE` + `AUTHORIZED` $\rightarrow$ Cryptographically authentic credential from an active authorized issuer.
- **Revoked but Authorized Issuer:** `EXISTS` + `MATCH` + `REVOKED` + `AUTHORIZED` $\rightarrow$ Document matches original bytes, but was revoked by the issuer.
- **Active but Issuer De-authorized:** `EXISTS` + `MATCH` + `ACTIVE` + `DEAUTHORIZED` $\rightarrow$ Document matches original bytes, but issuer's authorization was subsequently removed.
- **Revoked and Issuer De-authorized:** `EXISTS` + `MATCH` + `REVOKED` + `DEAUTHORIZED` $\rightarrow$ Document was revoked, and issuer authorization was also removed.
- **Metadata Inspection Only (No File Dropped):** `EXISTS` + `UNCHECKED_NO_FILE` + `ACTIVE/REVOKED` + `AUTH/DEAUTH` $\rightarrow$ On-chain record displayed; document file remains unverified.
- **Tampered / Altered Document:** `EXISTS` + `MISMATCH` + Any Revocation + Any Auth $\rightarrow$ The provided PDF does not match the registered cryptographic digest.
- **Unregistered:** `NOT_FOUND` $\rightarrow$ No certificate record found for the provided Certificate ID.
- **Transport Failure:** `RPC_ERROR` $\rightarrow$ Network unreachable or RPC timeout; node could not be queried.

### 5.3 Semantic & Legal Boundaries

1. **Byte-Level Equivalence Only:** A positive verification outcome proves **strictly and solely** that the candidate file presented by the verifier is bit-for-bit identical to the file hashed by the issuer at the recorded timestamp.
2. **No Warranties on Contents:** A valid hash match does **not** prove that the student completed coursework, that grades are accurate, that the issuing entity holds legal accreditation, or that the document is legally binding.
3. **Issuer Name is Advisory Metadata:** Institutional display names (e.g., "State University") retrieved from off-chain databases are informational convenience tags. The cryptographic root of trust is the Ethereum wallet address (`0x...`).
4. **Link Access is Not Verification:** Navigating to `https://certproof.app/verify/<id>` displays public on-chain metadata (issuer address, registration timestamp, revocation status). **It does not constitute document verification until the verifier selects a local PDF file and confirms a byte match.**

---

## 6. Functional Acceptance Criteria

### 6.1 Issuer Authentication & Authorization
- **AC-1.1:** An issuer connects an EVM wallet and signs an EIP-4361 (SIWE) challenge containing an atomic, single-use nonce, domain binding, and expiration timestamp.
- **AC-1.2:** The server validates the signature and establishes an HTTP-only, Secure session backed by MongoDB server-side session persistence (Sprint 3; not implemented in Sprint 2).
- **AC-1.3:** If the authenticated wallet is not on the registry contract's `isAuthorizedIssuer` list, dashboard registration controls are disabled, displaying an "Unauthorized Issuer" notice.

### 6.2 Client-Side Document Hashing & Preparation
- **AC-2.1:** When an issuer selects a file, the browser verifies that the file format begins with magic bytes `%PDF-` (`0x25 0x50 0x44 0x46 0x2D`) and is within the 32 MB limit.
- **AC-2.2:** The browser computes the Keccak-256 hash across the raw byte buffer using a zero-normalization pipeline.
- **AC-2.3:** The file hash, byte length, and an opaque, randomly generated Certificate ID (`bytes32`) are frozen in local state prior to transaction dispatch.
- **AC-2.4:** The browser performs **zero network requests** containing the PDF file or its byte content.

### 6.3 On-Chain Registration & Deduplication
- **AC-3.1:** The issuer submits `registerCertificate(bytes32 certId, bytes32 documentHash)`.
- **AC-3.2:** If `(msg.sender, documentHash)` has already been registered by this issuer, the transaction reverts with `CertProof__AlreadyRegistered()`. This duplicate prohibition remains permanently active, even if the previously issued certificate was revoked. A changed file produces a distinct hash and can be registered as a new certificate.
- **AC-3.3:** If a different authorized issuer previously registered the same document hash under a different `certId`, the transaction succeeds, establishing independent provenance.
- **AC-3.4:** On transaction confirmation, the application extracts the validated `certId` from receipt event logs (never relying on speculative client state or global counter indices).

### 6.4 Permanent Revocation
- **AC-4.1:** An issuer initiates revocation of an existing certificate from the dashboard.
- **AC-4.2:** The transaction `revokeCertificate(bytes32 certId)` succeeds **only** if `msg.sender == certificate.issuer`.
- **AC-4.3:** The original issuer can revoke their certificate even if their issuer authorization was subsequently removed by the registry administrator.
- **AC-4.4:** Revocation is irreversible. Any subsequent call to revoke an already-revoked certificate reverts with `CertProof__AlreadyRevoked()`. No reactivation function exists.

### 6.5 Public Verification & Hash Comparison
- **AC-5.1:** Anyone visiting `/verify/[certId]` without a wallet or session can view on-chain status: Issuer Address, Timestamp, Document Hash, and Revocation Status via direct, unauthenticated RPC read.
- **AC-5.2:** When a verifier selects a local PDF on `/verify/[certId]`, the client computes the file's hash in-memory.
- **AC-5.3:** If `clientComputedHash === onChainRecord.documentHash`, the UI displays a confirmed byte-match state. If they differ, the UI displays an explicit mismatch alert showing the computed vs registered values.
- **AC-5.4:** If the RPC node is offline or times out, the UI explicitly flags `Verification Service Unavailable` rather than reporting the certificate as non-existent.
