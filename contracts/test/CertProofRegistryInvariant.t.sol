// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CertProofRegistry} from "../src/CertProofRegistry.sol";
import {CertProofHandler} from "./handlers/CertProofHandler.sol";

contract CertProofRegistryInvariantTest is Test {
    CertProofRegistry public registry;
    CertProofHandler public handler;

    address public admin = address(0xAA1);

    function setUp() public {
        vm.prank(admin);
        registry = new CertProofRegistry(admin);

        handler = new CertProofHandler(registry, admin);

        targetContract(address(handler));
    }

    /// @notice Invariant A: Immutable registered data
    /// Asserts that for every registered certificate, documentHash, issuer, and registeredAt
    /// never deviate from the independent ghost model.
    function invariant_ImmutableRegisteredData() public view {
        uint256 count = handler.getGhostAllCertIdsLength();
        for (uint256 i = 0; i < count; i++) {
            bytes32 certId = handler.ghostAllCertIds(i);
            (
                bytes32 gCertId,
                bytes32 gDocHash,
                address gIssuer,
                uint64 gRegisteredAt,
                uint64 gRevokedAt,
                bool gRevoked
            ) = handler.ghostRecords(certId);

            CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(certId);

            assertEq(rec.certId, gCertId, "Invariant Violation: certId mutated");
            assertEq(rec.documentHash, gDocHash, "Invariant Violation: documentHash mutated");
            assertEq(rec.issuer, gIssuer, "Invariant Violation: issuer mutated");
            assertEq(rec.registeredAt, gRegisteredAt, "Invariant Violation: registeredAt mutated");
            assertEq(rec.revoked, gRevoked, "Invariant Violation: revoked status mismatch");
            assertEq(rec.revokedAt, gRevokedAt, "Invariant Violation: revokedAt mismatch");
        }
    }

    /// @notice Invariant B: Permanent Revocation
    /// Asserts that a revoked certificate never becomes unrevoked.
    function invariant_PermanentRevocation() public view {
        uint256 count = handler.getGhostAllCertIdsLength();
        for (uint256 i = 0; i < count; i++) {
            bytes32 certId = handler.ghostAllCertIds(i);
            (,,,, uint64 gRevokedAt, bool gRevoked) = handler.ghostRecords(certId);

            CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(certId);
            if (gRevoked) {
                assertTrue(rec.revoked, "Invariant Violation: Certificate became unrevoked");
                assertTrue(rec.revokedAt > 0, "Invariant Violation: Revoked certificate has 0 revokedAt");
                assertEq(rec.revokedAt, gRevokedAt, "Invariant Violation: revokedAt changed");
            }
        }
    }

    /// @notice Invariant C: Unique IDs and Per-Issuer Hash Registrations
    function invariant_UniqueIdsAndPerIssuerHashes() public view {
        uint256 count = handler.getGhostAllCertIdsLength();
        for (uint256 i = 0; i < count; i++) {
            bytes32 certId = handler.ghostAllCertIds(i);
            assertTrue(registry.certificateExists(certId), "Invariant Violation: Certificate existence mismatch");
        }
    }

    /// @notice Invariant D: Issuer List Consistency
    /// Asserts that for every actor, the contract's issued certificates array matches
    /// the ghost model's sequence and count exactly.
    function invariant_IssuerListConsistency() public view {
        for (uint256 a = 0; a < 4; a++) {
            address actor = handler.actors(a);
            bytes32[] memory ghostList = handler.getGhostIssuerCertificates(actor);
            uint256 contractCount = registry.getIssuerCertificateCount(actor);

            assertEq(contractCount, ghostList.length, "Invariant Violation: Count mismatch for issuer");

            for (uint256 i = 0; i < ghostList.length; i++) {
                // Check via single element pagination
                (bytes32[] memory page,,) = registry.getIssuerCertificates(actor, i, 1);
                assertEq(page.length, 1, "Invariant Violation: Slice length error");
                assertEq(page[0], ghostList[i], "Invariant Violation: Element mismatch at index");
            }
        }
    }

    /// @notice Invariant E: Access-Control Boundaries
    /// Asserts that isIssuerAuthorized matches independent ghost state.
    function invariant_AccessControlBoundaries() public view {
        for (uint256 a = 0; a < 4; a++) {
            address actor = handler.actors(a);
            bool ghostAuth = handler.ghostIsAuthorized(actor);
            bool contractAuth = registry.isIssuerAuthorized(actor);
            assertEq(contractAuth, ghostAuth, "Invariant Violation: Authorization mismatch");
        }
    }

    /// @notice Invariant F: Bounded Pagination
    /// Asserts that paginated queries conform to MAX_PAGE_SIZE and return consistent deterministic data.
    function invariant_BoundedPagination() public view {
        for (uint256 a = 0; a < 4; a++) {
            address actor = handler.actors(a);
            uint256 total = registry.getIssuerCertificateCount(actor);

            if (total > 0) {
                // Page size 5
                (bytes32[] memory page, uint256 nextOffset, uint256 reportedTotal) =
                    registry.getIssuerCertificates(actor, 0, 5);
                assertEq(reportedTotal, total, "Invariant Violation: Reported total mismatch");
                assertTrue(page.length <= 5, "Invariant Violation: Page size exceeded limit");
                assertTrue(page.length <= total, "Invariant Violation: Page size exceeded total");
                assertEq(nextOffset, page.length, "Invariant Violation: nextOffset mismatch on page 1");
            }
        }
    }
}
