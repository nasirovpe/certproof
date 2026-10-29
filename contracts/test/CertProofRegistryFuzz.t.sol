// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CertProofRegistry} from "../src/CertProofRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract CertProofRegistryFuzzTest is Test {
    CertProofRegistry public registry;

    address public admin = address(0xAA1);
    address public issuer = address(0xBB1);

    function setUp() public {
        vm.prank(admin);
        registry = new CertProofRegistry(admin);

        vm.prank(admin);
        registry.setIssuerAuthorization(issuer, true);
    }

    function testFuzz_RegistrationStoresExactValues(bytes32 certId, bytes32 docHash, uint32 timestampDelta) public {
        vm.assume(certId != bytes32(0));
        vm.assume(docHash != bytes32(0));

        uint64 timestamp = uint64(1700000000 + uint256(timestampDelta));
        vm.warp(timestamp);

        vm.prank(issuer);
        registry.registerCertificate(certId, docHash);

        CertProofRegistry.CertificateRecord memory rec = registry.getCertificate(certId);
        assertEq(rec.certId, certId, "certId mismatch");
        assertEq(rec.documentHash, docHash, "documentHash mismatch");
        assertEq(rec.issuer, issuer, "issuer mismatch");
        assertEq(rec.registeredAt, timestamp, "registeredAt mismatch");
        assertEq(rec.revokedAt, 0, "revokedAt must be 0 initially");
        assertFalse(rec.revoked, "must not be revoked initially");
    }

    function testFuzz_PaginationBoundsNeverRevertOrOverflow(uint8 certCount, uint256 offset, uint256 limit) public {
        uint256 count = bound(uint256(certCount), 0, 40);
        uint256 validLimit = bound(limit, 1, registry.MAX_PAGE_SIZE());

        vm.startPrank(issuer);
        for (uint256 i = 0; i < count; i++) {
            bytes32 cId = keccak256(abi.encodePacked("CERT", i));
            bytes32 dHash = keccak256(abi.encodePacked("DOC", i));
            registry.registerCertificate(cId, dHash);
        }
        vm.stopPrank();

        (bytes32[] memory ids, uint256 nextOffset, uint256 total) =
            registry.getIssuerCertificates(issuer, offset, validLimit);

        assertEq(total, count, "total must match number of issued certificates");
        assertTrue(ids.length <= validLimit, "page size cannot exceed requested limit");

        if (offset >= count) {
            assertEq(ids.length, 0, "out-of-bounds offset must return empty page");
            assertEq(nextOffset, count, "out-of-bounds offset must return total as nextOffset");
        } else {
            uint256 expectedRemaining = count - offset;
            uint256 expectedCount = validLimit < expectedRemaining ? validLimit : expectedRemaining;
            assertEq(ids.length, expectedCount, "page length must equal min(limit, available)");
            assertEq(nextOffset, offset + expectedCount, "nextOffset must equal offset + count");

            for (uint256 j = 0; j < ids.length; j++) {
                bytes32 expectedId = keccak256(abi.encodePacked("CERT", offset + j));
                assertEq(ids[j], expectedId, "element must match chronological index");
            }
        }
    }

    function testFuzz_UnauthorizedCallerCannotAuthorize(address caller, address targetIssuer, bool status) public {
        vm.assume(caller != admin);

        vm.prank(caller);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, caller));
        registry.setIssuerAuthorization(targetIssuer, status);
    }

    function testFuzz_UnauthorizedCallerCannotRevoke(address caller, bytes32 certSeed, bytes32 docSeed) public {
        vm.assume(certSeed != bytes32(0));
        vm.assume(docSeed != bytes32(0));
        vm.assume(caller != issuer);

        vm.prank(issuer);
        registry.registerCertificate(certSeed, docSeed);

        vm.prank(caller);
        vm.expectRevert(CertProofRegistry.CertProof__NotCertificateIssuer.selector);
        registry.revokeCertificate(certSeed);
    }
}
