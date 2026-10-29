// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title CertProofRegistry
 * @author CertProof Team
 * @notice Authoritative smart contract registry for decentralized, privacy-preserving
 * digital credential verification on Ethereum.
 * @dev Stores opaque certificate IDs, Keccak-256 document digests, original issuer addresses,
 * and immutable timestamps. Does NOT store student PII, grades, emails, or PDF bytes.
 * Public blockchain state: all getter data and events are permanently visible on-chain.
 */
contract CertProofRegistry is Ownable2Step {
    // --- Data Structures ---

    /**
     * @notice Immutable record representing an anchored certificate on-chain.
     * @param certId Unique opaque 32-byte certificate identifier.
     * @param documentHash Keccak-256 digest of unaltered candidate PDF bytes.
     * @param issuer Immutable address of the original issuing wallet.
     * @param registeredAt Unix timestamp of original registration block.
     * @param revokedAt Unix timestamp of revocation (0 if active).
     * @param revoked Irreversible revocation flag.
     */
    struct CertificateRecord {
        bytes32 certId;
        bytes32 documentHash;
        address issuer;
        uint64 registeredAt;
        uint64 revokedAt;
        bool revoked;
    }

    // --- Constants ---

    /// @notice Maximum allowed certificates returned per pagination request.
    uint256 public constant MAX_PAGE_SIZE = 50;

    // --- State Storage ---

    /// @dev Maps opaque certificate ID to its immutable on-chain record.
    mapping(bytes32 => CertificateRecord) private _certificates;

    /// @dev Tracks whether an address is currently an authorized issuer.
    mapping(address => bool) private _isAuthorizedIssuer;

    /// @dev Permanent deduplication mapping: (issuer => (documentHash => certId)).
    /// Enforces that an issuer cannot re-register the same document hash, even after revocation.
    mapping(address => mapping(bytes32 => bytes32)) private _issuerDocToCertId;

    /// @dev Chronological array of all certificate IDs issued by an address.
    mapping(address => bytes32[]) private _issuerCertificates;

    // --- Events ---

    /**
     * @notice Emitted when the administrator updates an issuer's authorization status.
     * @param issuer The address whose authorization status changed.
     * @param isAuthorized The new authorization status (true = authorized, false = deauthorized).
     */
    event IssuerAuthorizationChanged(address indexed issuer, bool isAuthorized);

    /**
     * @notice Emitted when a new certificate is anchored to the registry.
     * @param certId Unique opaque identifier for the certificate.
     * @param issuer Address of the issuing institution (msg.sender).
     * @param documentHash Keccak-256 hash of the certificate file.
     * @param registeredAt Block timestamp of registration.
     */
    event CertificateRegistered(
        bytes32 indexed certId, address indexed issuer, bytes32 indexed documentHash, uint256 registeredAt
    );

    /**
     * @notice Emitted when a certificate is permanently revoked by its original issuer.
     * @param certId Unique opaque identifier of the revoked certificate.
     * @param issuer Address of the original issuer executing the revocation.
     * @param revokedAt Block timestamp of revocation.
     */
    event CertificateRevoked(bytes32 indexed certId, address indexed issuer, uint256 revokedAt);

    // --- Custom Errors ---

    /// @notice Thrown when an input address is address(0).
    error CertProof__InvalidAddress();

    /// @notice Thrown when an input certificate ID is bytes32(0).
    error CertProof__InvalidCertId();

    /// @notice Thrown when an input document hash is bytes32(0).
    error CertProof__InvalidDocumentHash();

    /// @notice Thrown when a non-authorized caller attempts to register a certificate.
    error CertProof__UnauthorizedIssuer();

    /// @notice Thrown when a duplicate registration is attempted for (issuer, documentHash).
    error CertProof__AlreadyRegistered();

    /// @notice Thrown when the provided certId is already registered by any issuer.
    error CertProof__CertIdAlreadyExists();

    /// @notice Thrown when an operation is attempted on a non-existent certificate.
    error CertProof__CertificateNotFound();

    /// @notice Thrown when an entity other than the original issuer attempts to revoke.
    error CertProof__NotCertificateIssuer();

    /// @notice Thrown when attempting to revoke an already revoked certificate.
    error CertProof__AlreadyRevoked();

    /// @notice Thrown when requested pagination limit is 0 or exceeds MAX_PAGE_SIZE.
    error CertProof__InvalidPageLimit(uint256 limit, uint256 maxLimit);

    /// @notice Thrown when attempting to renounce contract ownership.
    error CertProof__RenounceOwnershipDisabled();

    // --- Constructor ---

    /**
     * @notice Initializes the registry with an initial administrator.
     * @dev Administrator is NOT automatically granted issuer authorization.
     * If the administrator wishes to register certificates, it must explicitly call
     * `setIssuerAuthorization(adminAddress, true)`.
     * @param initialOwner Address of the initial administrator (must be non-zero).
     */
    constructor(address initialOwner) Ownable(initialOwner) {
        // Base constructor Ownable(initialOwner) enforces initialOwner != address(0)
    }

    // --- Ownership Renunciation Policy ---

    /**
     * @notice Disables accidental or intentional ownership renunciation.
     * @dev To prevent permanently abandoning the registry without an admin,
     * ownership can only be transferred using the 2-step process (`transferOwnership` + `acceptOwnership`).
     */
    function renounceOwnership() public view override onlyOwner {
        revert CertProof__RenounceOwnershipDisabled();
    }

    // --- Administrative Functions ---

    /**
     * @notice Authorizes or deauthorizes an issuer address to register certificates.
     * @dev Callable only by the contract owner (administrator).
     * Deauthorizing an issuer does not alter or invalidate previously issued certificates.
     * @param issuer The address to update.
     * @param isAuthorized True to authorize, false to deauthorize.
     */
    function setIssuerAuthorization(address issuer, bool isAuthorized) external onlyOwner {
        if (issuer == address(0)) {
            revert CertProof__InvalidAddress();
        }
        // forge-lint: disable-next-line(missing-events-access-control)
        _isAuthorizedIssuer[issuer] = isAuthorized;
        emit IssuerAuthorizationChanged(issuer, isAuthorized);
    }

    // --- Issuer Functions ---

    /**
     * @notice Registers a new certificate on-chain.
     * @dev Issuer address is strictly derived from `msg.sender` (never trusted from calldata).
     * Caller must be currently authorized.
     * Neither `certId` nor `documentHash` may be zero.
     * `certId` must be globally unique across all issuers.
     * `(msg.sender, documentHash)` duplicate registration is permanently forbidden.
     * Different issuers may independently register the same documentHash under different certIds.
     * @param certId Cryptographically random, opaque 32-byte identifier.
     * @param documentHash Keccak-256 digest of unaltered candidate PDF bytes.
     */
    function registerCertificate(bytes32 certId, bytes32 documentHash) external {
        if (!_isAuthorizedIssuer[msg.sender]) {
            revert CertProof__UnauthorizedIssuer();
        }
        if (certId == bytes32(0)) {
            revert CertProof__InvalidCertId();
        }
        if (documentHash == bytes32(0)) {
            revert CertProof__InvalidDocumentHash();
        }
        if (_certificates[certId].registeredAt != 0) {
            revert CertProof__CertIdAlreadyExists();
        }
        if (_issuerDocToCertId[msg.sender][documentHash] != bytes32(0)) {
            revert CertProof__AlreadyRegistered();
        }

        // block.timestamp fits comfortably in uint64 until year 584 billion
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 currentTimestamp = uint64(block.timestamp);

        _certificates[certId] = CertificateRecord({
            certId: certId,
            documentHash: documentHash,
            issuer: msg.sender,
            registeredAt: currentTimestamp,
            revokedAt: 0,
            revoked: false
        });

        _issuerDocToCertId[msg.sender][documentHash] = certId;
        _issuerCertificates[msg.sender].push(certId);

        emit CertificateRegistered(certId, msg.sender, documentHash, currentTimestamp);
    }

    /**
     * @notice Permanently revokes an existing certificate on-chain.
     * @dev Callable SOLELY by the original issuing wallet (`msg.sender == record.issuer`).
     * The original issuer may revoke even if subsequently deauthorized by the administrator.
     * Revocation is unidirectional and irreversible; re-revoking reverts with `CertProof__AlreadyRevoked`.
     * @param certId The opaque certificate ID to revoke.
     */
    function revokeCertificate(bytes32 certId) external {
        CertificateRecord storage record = _certificates[certId];

        if (record.registeredAt == 0) {
            revert CertProof__CertificateNotFound();
        }
        if (record.issuer != msg.sender) {
            revert CertProof__NotCertificateIssuer();
        }
        if (record.revoked) {
            revert CertProof__AlreadyRevoked();
        }

        // block.timestamp fits comfortably in uint64 until year 584 billion
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 currentTimestamp = uint64(block.timestamp);
        record.revoked = true;
        record.revokedAt = currentTimestamp;

        emit CertificateRevoked(certId, msg.sender, currentTimestamp);
    }

    // --- Read Getters (Public Blockchain Data) ---

    /**
     * @notice Reads a certificate record by its opaque identifier.
     * @dev If the certificate does not exist, returns an empty struct where `registeredAt == 0`
     * and `issuer == address(0)`. Callers can also verify via `certificateExists(certId)`.
     * @param certId The opaque certificate identifier to inspect.
     * @return record The complete on-chain CertificateRecord struct.
     */
    function getCertificate(bytes32 certId) external view returns (CertificateRecord memory record) {
        return _certificates[certId];
    }

    /**
     * @notice Returns whether a certificate ID exists on-chain.
     * @param certId The opaque certificate identifier to check.
     * @return True if the certificate was registered; false otherwise.
     */
    function certificateExists(bytes32 certId) external view returns (bool) {
        return _certificates[certId].registeredAt != 0;
    }

    /**
     * @notice Queries whether an address is currently an authorized issuer.
     * @param issuer The address to inspect.
     * @return True if currently authorized; false otherwise.
     */
    function isIssuerAuthorized(address issuer) external view returns (bool) {
        return _isAuthorizedIssuer[issuer];
    }

    /**
     * @notice Retrieves total number of certificates registered by an issuer.
     * @param issuer The issuer address to query.
     * @return Total count of registered certificates (including revoked).
     */
    function getIssuerCertificateCount(address issuer) external view returns (uint256) {
        return _issuerCertificates[issuer].length;
    }

    /**
     * @notice Returns a bounded, paginated slice of certificate IDs issued by an address.
     * @dev Enforces deterministic chronological ordering (index 0 is oldest).
     * Revoked certificates remain in history and are included in the returned slice.
     * Reverts with `CertProof__InvalidPageLimit` if limit is 0 or exceeds `MAX_PAGE_SIZE`.
     * If `offset >= total`, returns an empty array with `nextOffset = total`.
     * If `offset + count == total`, `nextOffset = total` signifies the final page.
     * @param issuer The issuer address whose certificates are queried.
     * @param offset Starting index in the issuer's certificate array.
     * @param limit Maximum number of certificate IDs to return (1 to 50).
     * @return certIds Array of certificate IDs for the requested page.
     * @return nextOffset Cursor for the next page (`nextOffset == total` when complete).
     * @return total Total number of certificates issued by this address.
     */
    function getIssuerCertificates(address issuer, uint256 offset, uint256 limit)
        external
        view
        returns (bytes32[] memory certIds, uint256 nextOffset, uint256 total)
    {
        if (limit == 0 || limit > MAX_PAGE_SIZE) {
            revert CertProof__InvalidPageLimit(limit, MAX_PAGE_SIZE);
        }

        bytes32[] storage allCertificates = _issuerCertificates[issuer];
        total = allCertificates.length;

        if (offset >= total) {
            return (new bytes32[](0), total, total);
        }

        uint256 available = total - offset;
        uint256 count = limit < available ? limit : available;

        certIds = new bytes32[](count);
        for (uint256 i = 0; i < count; i++) {
            certIds[i] = allCertificates[offset + i];
        }

        nextOffset = offset + count;
        return (certIds, nextOffset, total);
    }
}
