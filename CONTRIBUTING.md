# Contributing to CertProof

Thank you for your interest in CertProof. This project serves as an educational reference architecture demonstrating privacy-preserving document integrity verification on EVM chains.

## Development Workflow & Prerequisites

To set up the development environment, ensure you have:
- **Node.js**: v22 LTS (Node 22 "Jod" supported LTS; Node 20 reached End-of-Life on April 30, 2026)
- **Foundry Toolchain**: `forge`, `anvil`, `cast` (installed via `foundryup`)
- **Docker & Docker Compose**: For containerized packaging and local persistence testing

### Initial Setup

1. Clone repository with submodules:
   ```bash
   git clone --recurse-submodules <repo-url>
   cd CertProof
   ```
   *(If already cloned, run: `git submodule update --init --recursive`)*

2. Install root and frontend dependencies:
   ```bash
   npm ci
   cd frontend && npm ci && cd ..
   ```

3. Build contracts and export ABI:
   ```bash
   npm run compile
   npm run export-abi
   ```

## Local Verification Standards

Before submitting a Pull Request, verify that all automated checks pass cleanly:

```bash
# 1. Smart Contract Tests (38 Foundry unit, fuzz, and invariant tests)
npm run test

# 2. Frontend Unit & Integration Tests (150 Vitest suites)
npm run web:test

# 3. TypeScript Typecheck & ESLint
npm run web:lint
cd frontend && npx tsc --noEmit && cd ..

# 4. Deployment Manifest Validation
npm run verify:manifest

# 5. Isolated Anvil Persistence Verification
npm run verify:anvil-persistence

# 6. Full Package Container Smoke Test (Multi-stage Docker, Web Worker chunks, MongoDB)
npm run smoke:package
```

## Contribution Principles

- **Zero-Data Leak Privacy Boundary**: Document bytes must never be transmitted over HTTP, written to MongoDB, or submitted to any blockchain transaction. Cryptographic hashing must occur client-side in the Web Worker.
- **Security & Hygiene**: Never commit private keys, `.env.local` files, real seed phrases, or production credentials. Use only standard disposable Anvil test accounts for local workflows.
- **Commit History & Scope**: Keep PRs focused, well-documented, and backed by automated tests.
