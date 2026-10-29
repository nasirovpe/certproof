// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CertProofRegistry} from "../src/CertProofRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CertProofRegistryUnitTest is Test {
    CertProofRegistry public registry;

    address public admin = address(0xAA1);
    address public issuer1 = address(0xBB1);
    address public issuer2 = address(0xBB2);
    address public stranger = address(0xCC1);
    address public newAdmin = address(0xAA2);

    bytes32 public constant FIXTURE_ORIGINAL_HASH = 0xf98502a9365a9b66aab2d6e1cb5395027ac6820df744fc8013c3065341ad7daf;
    bytes32 public constant FIXTURE_MODIFIED_HASH = 0xb738b380d12bfc3dd1c3afd068af6ef821b33aec782a6ee028bd17bc1fff7be7;

    event IssuerAuthorizationChanged(address indexed issuer, bool isAuthorized);
    event CertificateRegistered(
        bytes32 indexed certId, address indexed issuer, bytes32 indexed documentHash, uint256 registeredAt
    );
    event CertificateRevoked(bytes32 indexed certId, address indexed issuer, uint256 revokedAt);

    function setUp() public {
        vm.prank(admin);
        registry = new CertProofRegistry(admin);
    }

    // --- Constructor & Admin Self-Authorization ---

    function test_ConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new CertProofRegistry(address(0));
    }

    function test_InitialAdminIsNotAuthorizedIssuerByDefault() public view {
        assertEq(registry.owner(), admin);
        assertFalse(registry.isIssuerAuthorized(admin));
    }

    // --- Ownership Renunciation & Two-Step Transfer ---

    function test_RenounceOwnershipIsDisabled() public {
        vm.prank(admin);
        vm.expectRevert(CertProofRegistry.CertProof__RenounceOwnershipDisabled.selector);
        registry.renounceOwnership();
    }

    function test_TwoStepOwnershipTransfer() public {
        vm.prank(admin);
        registry.transferOwnership(newAdmin);

        assertEq(registry.owner(), admin);
        assertEq(registry.pendingOwner(), newAdmin);

        // Stranger cannot accept
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.acceptOwnership();

        // New owner accepts
        vm.prank(newAdmin);
        registry.acceptOwnership();

        assertEq(registry.owner(), newAdmin);
        assertEq(registry.pendingOwner(), address(0));
    }

    // --- Issuer Authorization & Revocation Lifecycle ---

    function test_AdminCanAuthorizeAndDeauthorizeIssuer() public {
        assertFalse(registry.isIssuerAuthorized(issuer1));

        vm.expectEmit(true, false, false, true);
        emit IssuerAuthorizationChanged(issuer1, true);
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);
        assertTrue(registry.isIssuerAuthorized(issuer1));

        vm.expectEmit(true, false, false, true);
        emit IssuerAuthorizationChanged(issuer1, false);
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, false);
        assertFalse(registry.isIssuerAuthorized(issuer1));
    }

    function test_ReauthorizeIssuer() public {
        vm.startPrank(admin);
        registry.setIssuerAuthorization(issuer1, true);
        registry.setIssuerAuthorization(issuer1, false);
        registry.setIssuerAuthorization(issuer1, true);
        vm.stopPrank();

        assertTrue(registry.isIssuerAuthorized(issuer1));
    }

    function test_NonAdminCannotAuthorizeIssuer() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        registry.setIssuerAuthorization(issuer1, true);
    }

    function test_SetIssuerAuthorizationZeroAddressReverts() public {
        vm.prank(admin);
        vm.expectRevert(CertProofRegistry.CertProof__InvalidAddress.selector);
        registry.setIssuerAuthorization(address(0), true);
    }

    // --- Certificate Registration ---

    function test_AuthorizedIssuerCanRegisterCertificate() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 certId = keccak256("CERT_1");
        bytes32 docHash = FIXTURE_ORIGINAL_HASH;

        vm.warp(1700000000);

        vm.expectEmit(true, true, true, true);
        emit CertificateRegistered(certId, issuer1, docHash, 1700000000);

        vm.prank(issuer1);
        registry.registerCertificate(certId, docHash);

        assertTrue(registry.certificateExists(certId));

        CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(certId);
        assertEq(rec.certId, certId);
        assertEq(rec.documentHash, docHash);
        assertEq(rec.issuer, issuer1);
        assertEq(rec.registeredAt, 1700000000);
        assertEq(rec.revokedAt, 0);
        assertFalse(rec.revoked);
    }

    function test_UnauthorizedIssuerCannotRegister() public {
        bytes32 certId = keccak256("CERT_1");
        bytes32 docHash = FIXTURE_ORIGINAL_HASH;

        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__UnauthorizedIssuer.selector);
        registry.registerCertificate(certId, docHash);
    }

    function test_DeauthorizedIssuerCannotRegister() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, false);

        bytes32 certId = keccak256("CERT_1");
        bytes32 docHash = FIXTURE_ORIGINAL_HASH;

        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__UnauthorizedIssuer.selector);
        registry.registerCertificate(certId, docHash);
    }

    function test_ZeroCertIdReverts() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__InvalidCertId.selector);
        registry.registerCertificate(bytes32(0), FIXTURE_ORIGINAL_HASH);
    }

    function test_ZeroDocumentHashReverts() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__InvalidDocumentHash.selector);
        registry.registerCertificate(keccak256("CERT_1"), bytes32(0));
    }

    function test_DuplicateCertIdCollisionRevertsGlobally() public {
        vm.startPrank(admin);
        registry.setIssuerAuthorization(issuer1, true);
        registry.setIssuerAuthorization(issuer2, true);
        vm.stopPrank();

        bytes32 sharedCertId = keccak256("SHARED_ID");

        vm.prank(issuer1);
        registry.registerCertificate(sharedCertId, keccak256("DOC_1"));

        // Same issuer reusing certId reverts
        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__CertIdAlreadyExists.selector);
        registry.registerCertificate(sharedCertId, keccak256("DOC_2"));

        // Different issuer using same certId reverts
        vm.prank(issuer2);
        vm.expectRevert(CertProofRegistry.CertProof__CertIdAlreadyExists.selector);
        registry.registerCertificate(sharedCertId, keccak256("DOC_3"));
    }

    function test_DuplicateIssuerDocumentHashReverts() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 docHash = FIXTURE_ORIGINAL_HASH;

        vm.prank(issuer1);
        registry.registerCertificate(keccak256("CERT_1"), docHash);

        // Same issuer registering same docHash with different certId reverts
        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__AlreadyRegistered.selector);
        registry.registerCertificate(keccak256("CERT_2"), docHash);
    }

    function test_DuplicateIssuerDocumentHashPermanentlyBlockedAfterRevocation() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 cert1 = keccak256("CERT_1");
        bytes32 docHash = FIXTURE_ORIGINAL_HASH;

        vm.prank(issuer1);
        registry.registerCertificate(cert1, docHash);

        vm.prank(issuer1);
        registry.revokeCertificate(cert1);

        // Re-registration of same docHash by same issuer is permanently blocked
        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__AlreadyRegistered.selector);
        registry.registerCertificate(keccak256("CERT_2"), docHash);
    }

    function test_DifferentIssuersCanRegisterSameDocumentHash() public {
        vm.startPrank(admin);
        registry.setIssuerAuthorization(issuer1, true);
        registry.setIssuerAuthorization(issuer2, true);
        vm.stopPrank();

        bytes32 sharedDocHash = FIXTURE_ORIGINAL_HASH;
        bytes32 cert1 = keccak256("CERT_ISSUER1");
        bytes32 cert2 = keccak256("CERT_ISSUER2");

        vm.prank(issuer1);
        registry.registerCertificate(cert1, sharedDocHash);

        vm.prank(issuer2);
        registry.registerCertificate(cert2, sharedDocHash);

        CertProofRegistry.CertificateRecord memory rec1 = registry.getCertificate(cert1);
        CertProofRegistry.CertificateRecord memory rec2 = registry.getCertificate(cert2);

        assertEq(rec1.issuer, issuer1);
        assertEq(rec2.issuer, issuer2);
        assertEq(rec1.documentHash, sharedDocHash);
        assertEq(rec2.documentHash, sharedDocHash);
    }

    function test_ChangedDocumentHashAllowsNewRegistration() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 cert1 = keccak256("CERT_1");
        bytes32 cert2 = keccak256("CERT_2");

        vm.startPrank(issuer1);
        registry.registerCertificate(cert1, FIXTURE_ORIGINAL_HASH);
        // Changed file produces FIXTURE_MODIFIED_HASH
        registry.registerCertificate(cert2, FIXTURE_MODIFIED_HASH);
        vm.stopPrank();

        assertEq(registry.getIssuerCertificateCount(issuer1), 2);
    }

    // --- Revocation Lifecycle & Permissions ---

    function test_OriginalIssuerCanRevoke() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 certId = keccak256("CERT_1");
        vm.prank(issuer1);
        registry.registerCertificate(certId, FIXTURE_ORIGINAL_HASH);

        vm.warp(1700001000);
        vm.expectEmit(true, true, false, true);
        emit CertificateRevoked(certId, issuer1, 1700001000);

        vm.prank(issuer1);
        registry.revokeCertificate(certId);

        CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(certId);
        assertTrue(rec.revoked);
        assertEq(rec.revokedAt, 1700001000);
        assertEq(rec.issuer, issuer1);
    }

    function test_OriginalIssuerCanRevokeAfterDeauthorization() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 certId = keccak256("CERT_1");
        vm.prank(issuer1);
        registry.registerCertificate(certId, FIXTURE_ORIGINAL_HASH);

        // Admin deauthorizes issuer1
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, false);
        assertFalse(registry.isIssuerAuthorized(issuer1));

        // Original issuer can still revoke its certificate
        vm.warp(1700002000);
        vm.prank(issuer1);
        registry.revokeCertificate(certId);

        CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(certId);
        assertTrue(rec.revoked);
        assertEq(rec.revokedAt, 1700002000);
    }

    function test_NonIssuerCannotRevoke() public {
        vm.startPrank(admin);
        registry.setIssuerAuthorization(issuer1, true);
        registry.setIssuerAuthorization(issuer2, true);
        vm.stopPrank();

        bytes32 certId = keccak256("CERT_1");
        vm.prank(issuer1);
        registry.registerCertificate(certId, FIXTURE_ORIGINAL_HASH);

        // Another authorized issuer cannot revoke
        vm.prank(issuer2);
        vm.expectRevert(CertProofRegistry.CertProof__NotCertificateIssuer.selector);
        registry.revokeCertificate(certId);

        // Stranger cannot revoke
        vm.prank(stranger);
        vm.expectRevert(CertProofRegistry.CertProof__NotCertificateIssuer.selector);
        registry.revokeCertificate(certId);
    }

    function test_AdminCannotRevokeIssuerCertificate() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 certId = keccak256("CERT_1");
        vm.prank(issuer1);
        registry.registerCertificate(certId, FIXTURE_ORIGINAL_HASH);

        vm.prank(admin);
        vm.expectRevert(CertProofRegistry.CertProof__NotCertificateIssuer.selector);
        registry.revokeCertificate(certId);
    }

    function test_RevokeNonexistentCertificateReverts() public {
        bytes32 ghostId = keccak256("GHOST_CERT");
        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__CertificateNotFound.selector);
        registry.revokeCertificate(ghostId);
    }

    function test_RepeatedRevocationReverts() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 certId = keccak256("CERT_1");
        vm.prank(issuer1);
        registry.registerCertificate(certId, FIXTURE_ORIGINAL_HASH);

        vm.prank(issuer1);
        registry.revokeCertificate(certId);

        // Second revocation reverts clearly
        vm.prank(issuer1);
        vm.expectRevert(CertProofRegistry.CertProof__AlreadyRevoked.selector);
        registry.revokeCertificate(certId);
    }

    function test_IndependentRevokedAndDeauthorizedStates() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 certId = keccak256("CERT_1");
        vm.prank(issuer1);
        registry.registerCertificate(certId, FIXTURE_ORIGINAL_HASH);

        // Revoke certificate
        vm.prank(issuer1);
        registry.revokeCertificate(certId);

        // Deauthorize issuer
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, false);

        // Both states hold simultaneously and independently
        CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(certId);
        assertTrue(rec.revoked);
        assertFalse(registry.isIssuerAuthorized(issuer1));
        assertEq(rec.issuer, issuer1);

        // Reauthorizing issuer does NOT unrevoke the certificate
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);
        assertTrue(registry.isIssuerAuthorized(issuer1));
        rec = registry.getCertificate(certId);
        assertTrue(rec.revoked);
    }

    // --- Unknown Certificate Reads ---

    function test_UnknownCertificateReads() public view {
        bytes32 unknownCertId = keccak256("NON_EXISTENT");

        assertFalse(registry.certificateExists(unknownCertId));

        CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(unknownCertId);
        assertEq(rec.certId, bytes32(0));
        assertEq(rec.documentHash, bytes32(0));
        assertEq(rec.issuer, address(0));
        assertEq(rec.registeredAt, 0);
        assertEq(rec.revokedAt, 0);
        assertFalse(rec.revoked);
    }

    // --- Pagination Tests ---

    function test_PaginationZeroLimitReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CertProofRegistry.CertProof__InvalidPageLimit.selector, 0, 50));
        registry.getIssuerCertificates(issuer1, 0, 0);
    }

    function test_PaginationExcessiveLimitReverts() public {
        vm.expectRevert(abi.encodeWithSelector(CertProofRegistry.CertProof__InvalidPageLimit.selector, 51, 50));
        registry.getIssuerCertificates(issuer1, 0, 51);
    }

    function test_PaginationEmptyArrayWhenNoCerts() public view {
        (bytes32[] memory ids, uint256 nextOffset, uint256 total) = registry.getIssuerCertificates(issuer1, 0, 10);
        assertEq(ids.length, 0);
        assertEq(nextOffset, 0);
        assertEq(total, 0);
    }

    function test_PaginationOffsetBeyondEnd() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        vm.startPrank(issuer1);
        registry.registerCertificate(keccak256("C1"), keccak256("D1"));
        registry.registerCertificate(keccak256("C2"), keccak256("D2"));
        vm.stopPrank();

        (bytes32[] memory ids, uint256 nextOffset, uint256 total) = registry.getIssuerCertificates(issuer1, 5, 10);
        assertEq(ids.length, 0);
        assertEq(nextOffset, 2);
        assertEq(total, 2);
    }

    function test_PaginationOrderingAndSlices() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32[] memory expectedIds = new bytes32[](5);
        vm.startPrank(issuer1);
        for (uint256 i = 0; i < 5; i++) {
            expectedIds[i] = bytes32(uint256(100 + i));
            registry.registerCertificate(expectedIds[i], bytes32(uint256(1000 + i)));
        }
        vm.stopPrank();

        // Page 1: offset 0, limit 2
        (bytes32[] memory p1, uint256 next1, uint256 total1) = registry.getIssuerCertificates(issuer1, 0, 2);
        assertEq(p1.length, 2);
        assertEq(p1[0], expectedIds[0]);
        assertEq(p1[1], expectedIds[1]);
        assertEq(next1, 2);
        assertEq(total1, 5);

        // Page 2: offset 2, limit 2
        (bytes32[] memory p2, uint256 next2, uint256 total2) = registry.getIssuerCertificates(issuer1, 2, 2);
        assertEq(p2.length, 2);
        assertEq(p2[0], expectedIds[2]);
        assertEq(p2[1], expectedIds[3]);
        assertEq(next2, 4);
        assertEq(total2, 5);

        // Page 3: offset 4, limit 2 (last 1 item)
        (bytes32[] memory p3, uint256 next3, uint256 total3) = registry.getIssuerCertificates(issuer1, 4, 2);
        assertEq(p3.length, 1);
        assertEq(p3[0], expectedIds[4]);
        assertEq(next3, 5);
        assertEq(total3, 5);
    }

    function test_RevokedCertificatesRetainedInPagination() public {
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 c1 = keccak256("C1");
        bytes32 c2 = keccak256("C2");

        vm.startPrank(issuer1);
        registry.registerCertificate(c1, keccak256("D1"));
        registry.registerCertificate(c2, keccak256("D2"));
        registry.revokeCertificate(c1);
        vm.stopPrank();

        (bytes32[] memory ids,, uint256 total) = registry.getIssuerCertificates(issuer1, 0, 10);
        assertEq(total, 2);
        assertEq(ids.length, 2);
        assertEq(ids[0], c1);
        assertEq(ids[1], c2);

        CertProofRegistry.CertificateRecord memory rec1 = registry.getCertificate(c1);
        assertTrue(rec1.revoked);
    }

    // --- Hashing Fixture Tests ---

    function test_FixturesRawBytesKeccakMatchViemExpected() public {
        bytes memory origBytes = vm.readFileBinary("test/fixtures/original.pdf");
        bytes memory dupBytes = vm.readFileBinary("test/fixtures/duplicate.pdf");
        bytes memory modBytes = vm.readFileBinary("test/fixtures/modified.pdf");

        bytes32 solidityOrigHash = keccak256(origBytes);
        bytes32 solidityDupHash = keccak256(dupBytes);
        bytes32 solidityModHash = keccak256(modBytes);

        // 1. Identical bytes produce identical hashes
        assertEq(solidityOrigHash, solidityDupHash);
        assertEq(origBytes.length, dupBytes.length);

        // 2. Solidity bytes32 matches off-chain viem expected output exactly
        assertEq(solidityOrigHash, FIXTURE_ORIGINAL_HASH);

        // 3. One byte change produces a completely distinct hash
        assertTrue(solidityOrigHash != solidityModHash);
        assertEq(solidityModHash, FIXTURE_MODIFIED_HASH);

        // Register with fixture hash
        vm.prank(admin);
        registry.setIssuerAuthorization(issuer1, true);

        bytes32 certId = keccak256("FIXTURE_CERT");
        vm.prank(issuer1);
        registry.registerCertificate(certId, solidityOrigHash);

        CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(certId);
        assertEq(rec.documentHash, FIXTURE_ORIGINAL_HASH);
    }
}
