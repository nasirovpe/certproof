# CertProof — Reproducible Smart Contract Toolchain Specification

This document records the exact toolchain versions, EVM target justification, dependency revisions, and setup commands for the CertProof smart contracts.

---

## 1. Toolchain Components & Pinned Versions

| Tool / Dependency | Version / Tag | Resolved Commit Hash / Release | Rationale & Status |
| :--- | :--- | :--- | :--- |
| **Solidity Compiler** | `0.8.24` | `0.8.24+commit.e11b9ed9` | Concrete stable release with native overflow checks, custom error optimization, and Cancun execution support. |
| **EVM Execution Target** | `cancun` | N/A (Protocol Fork Specification) | Matches active consensus rules on Ethereum Mainnet (March 2024 Dencun hardfork) and Sepolia testnet (January 2024). |
| **Foundry CLI (Forge / Anvil / Cast)** | `1.8.6` | `6bad0a66de7c83f7b33695044138f0f5fa4c5990` | Pinned Foundry release providing native Solidity testing, fuzzing, invariant suites, and local Anvil node. |
| **OpenZeppelin Contracts** | `v5.7.0` | `cab19933c33c2ad1d4c7a84864a3601dddfd16f3` | Industry-standard security-reviewed contracts. Provides `Ownable2Step` and `Context`. |
| **forge-std** | `v1.17.0` | `f3dae6e6ee381f25eb6a246f7da9b85c91a68219` | Standard testing assertions, console logging, and cheatcode interfaces. |
| **Node.js Runtime** | `v22.23.2` / `v22 LTS` | Active Maintenance LTS (Node 20 EOL April 30, 2026) | Local ABI generation scripts, deployment validation, viem-based cryptographic verification, and Docker packaging. |

---

## 2. EVM Target Selection & Network Compatibility Rationale

The EVM target is explicitly pinned to **`cancun`** for the following technical reasons:

1. **Protocol Execution Rules:**
   - Ethereum Sepolia testnet activated the Cancun hardfork at epoch `132608` (January 30, 2024).
   - Ethereum Mainnet activated the Cancun hardfork at epoch `269568` (March 13, 2024).
   - Local Anvil (v1.8.6) executes `cancun` by default.
2. **Compiler Opcode Generation:**
   - Solidity `0.8.24` sets `cancun` as its default target, aligning optimizer rules and gas estimation with Cancun opcodes (including transient storage EIP-1153 `TSTORE`/`TLOAD` and blob base fee `MCOPY`).
   - Pinning `cancun` ensures zero compilation mismatch between local unit/fuzz tests on Anvil and subsequent deployment on Sepolia testnet.
3. **RPC Provider Independence:**
   - The decision is strictly grounded in network execution and compiler bytecode rules rather than speculative assumptions about third-party RPC provider support.

---

## 3. Compiler & Optimizer Configuration

The `foundry.toml` configuration pins:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
solc_version = "0.8.24"
evm_version = "cancun"
optimizer = true
optimizer_runs = 200

remappings = [
    "@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/",
    "forge-std/=lib/forge-std/src/"
]

[fuzz]
runs = 256
max_test_rejects = 65536

[invariant]
runs = 64
depth = 32
fail_on_revert = false
```

- **Optimizer Enabled:** `true`
- **Optimizer Runs:** `200` (standard balanced optimization between deployment bytecode size and routine runtime execution gas).

---

## 4. Setup & Reproducibility Commands

To reproduce the project environment from scratch:

```bash
# 1. Ensure Foundry and Node.js are available
export PATH="$HOME/.foundry/bin:$PATH"
forge --version
node --version

# 2. Enter contracts directory
cd contracts

# 3. Initialize foundry project (if not existing) and install exact submodules
forge install foundry-rs/forge-std@v1.17.0 --no-commit
forge install OpenZeppelin/openzeppelin-contracts@v5.7.0 --no-commit

# 4. Compile contracts
forge build

# 5. Run test suite
forge test -vvv
```

All submodule license files (`LICENSE` in `lib/forge-std` and `lib/openzeppelin-contracts`) and lockfiles are preserved untouched.
