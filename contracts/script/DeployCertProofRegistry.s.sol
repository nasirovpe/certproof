// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {CertProofRegistry} from "../src/CertProofRegistry.sol";

contract DeployCertProofRegistry is Script {
    function run() external returns (CertProofRegistry registry) {
        address deployer = msg.sender;
        address initialAdmin = vm.envOr("ADMIN_ADDRESS", deployer);

        require(initialAdmin != address(0), "Initial administrator cannot be address(0)");

        console2.log("=== CertProof Registry Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Initial Administrator:", initialAdmin);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast();
        registry = new CertProofRegistry(initialAdmin);
        vm.stopBroadcast();

        console2.log("Deployed CertProofRegistry Address:", address(registry));
        console2.log("Confirmed Owner:", registry.owner());
        console2.log("Owner is Authorized Issuer:", registry.isIssuerAuthorized(initialAdmin));
        console2.log("Max Page Size:", registry.MAX_PAGE_SIZE());
    }
}
