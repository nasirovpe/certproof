// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CertProofRegistry} from "../../src/CertProofRegistry.sol";

/**
 * @title CertProofHandler
 * @notice Independent stateful test handler modeling expected registry state.
 * @dev Tracks attempted calls, executed state transitions, and skipped calls separately.
 * Does NOT read from contract to populate ghost state.
 */
contract CertProofHandler is Test {
    CertProofRegistry public immutable registry;
    address public immutable admin;

    // Fixed pool of test actors
    address[] public actors;

    // Independent Ghost State
    struct GhostRecord {
        bytes32 certId;
        bytes32 documentHash;
        address issuer;
        uint64 registeredAt;
        uint64 revokedAt;
        bool revoked;
    }

    mapping(bytes32 => GhostRecord) public ghostRecords;
    bytes32[] public ghostAllCertIds;

    mapping(address => bool) public ghostIsAuthorized;
    mapping(address => mapping(bytes32 => bytes32)) public ghostIssuerDocToCertId;
    mapping(address => bytes32[]) public ghostIssuerCertificates;

    // Transition Call Metrics (Attempted vs Executed vs Skipped)
    uint256 public attemptedAuthorizations;
    uint256 public executedAuthorizations;
    uint256 public skippedAuthorizations;

    uint256 public attemptedRegistrations;
    uint256 public executedRegistrations;
    uint256 public skippedRegistrations;

    uint256 public attemptedRevocations;
    uint256 public executedRevocations;
    uint256 public skippedRevocations;

    // Seed counters for generating pseudo-unique IDs
    uint256 private _certNonce;
    uint256 private _docNonce;

    constructor(CertProofRegistry _registry, address _admin) {
        registry = _registry;
        admin = _admin;

        actors.push(address(0x101));
        actors.push(address(0x102));
        actors.push(address(0x103));
        actors.push(address(0x104));
    }

    function setIssuerAuthorization(uint256 actorIndex, bool status) external {
        attemptedAuthorizations++;

        address actor = actors[actorIndex % actors.length];

        // Only admin executes this call
        vm.prank(admin);
        registry.setIssuerAuthorization(actor, status);

        // Update independent ghost state
        ghostIsAuthorized[actor] = status;
        executedAuthorizations++;
    }

    function registerCertificate(uint256 actorIndex, uint256 docSeed, uint256 salt) external {
        attemptedRegistrations++;

        address actor = actors[actorIndex % actors.length];

        // Skip if actor is not authorized in ghost state
        if (!ghostIsAuthorized[actor]) {
            skippedRegistrations++;
            return;
        }

        // Generate non-zero certId and documentHash
        _certNonce++;
        bytes32 certId = keccak256(abi.encodePacked("INVARIANT_CERT", _certNonce, salt));
        bytes32 docHash = keccak256(abi.encodePacked("INVARIANT_DOC", docSeed % 10 + 1)); // reuse some doc hashes across actors

        // If certId collision exists in ghost state, skip
        if (ghostRecords[certId].registeredAt != 0) {
            skippedRegistrations++;
            return;
        }

        // If actor already registered this docHash, skip
        if (ghostIssuerDocToCertId[actor][docHash] != bytes32(0)) {
            skippedRegistrations++;
            return;
        }

        uint64 timestamp = uint64(block.timestamp);

        // Execute on contract
        vm.prank(actor);
        registry.registerCertificate(certId, docHash);

        // Update independent ghost state
        ghostRecords[certId] = GhostRecord({
            certId: certId, documentHash: docHash, issuer: actor, registeredAt: timestamp, revokedAt: 0, revoked: false
        });

        ghostAllCertIds.push(certId);
        ghostIssuerDocToCertId[actor][docHash] = certId;
        ghostIssuerCertificates[actor].push(certId);

        executedRegistrations++;
    }

    function revokeCertificate(uint256 certIndex, uint256 callerSeed) external {
        attemptedRevocations++;

        if (ghostAllCertIds.length == 0) {
            skippedRevocations++;
            return;
        }

        bytes32 certId = ghostAllCertIds[certIndex % ghostAllCertIds.length];
        GhostRecord storage ghost = ghostRecords[certId];

        // If already revoked, skip
        if (ghost.revoked) {
            skippedRevocations++;
            return;
        }

        address caller;
        if (callerSeed % 2 == 0) {
            // Valid caller: original issuer
            caller = ghost.issuer;
        } else {
            // Unauthorized caller: choose a different actor
            caller = actors[callerSeed % actors.length];
            if (caller == ghost.issuer) {
                caller = address(0x999);
            }
        }

        if (caller != ghost.issuer) {
            // Contract should revert, ghost state unchanged
            vm.prank(caller);
            try registry.revokeCertificate(certId) {
                revert("UnexpectedSuccess: Non-issuer revoked certificate");
            } catch {
                skippedRevocations++;
                return;
            }
        }

        uint64 timestamp = uint64(block.timestamp);

        // Execute valid revocation on contract
        vm.prank(caller);
        registry.revokeCertificate(certId);

        // Update ghost state
        ghost.revoked = true;
        ghost.revokedAt = timestamp;
        executedRevocations++;
    }

    function getGhostAllCertIdsLength() external view returns (uint256) {
        return ghostAllCertIds.length;
    }

    function getGhostIssuerCertificates(address actor) external view returns (bytes32[] memory) {
        return ghostIssuerCertificates[actor];
    }
}
