import {
  Address,
  Hex,
  PublicClient,
  TransactionReceipt,
  parseEventLogs,
  toHex,
} from 'viem';
import { CertProofRegistryABI } from '@/lib/abi/CertProofRegistry';
import {
  IssuerCertificateItem,
  PublicCertificateReadResult,
  PublicCertificateReadStatus,
  PublicCertificateRecord,
  CandidateFileComparison,
  CandidateFileStatus,
} from './types';

export type {
  IssuerCertificateItem,
  PublicCertificateReadResult,
  PublicCertificateReadStatus,
  PublicCertificateRecord,
  CandidateFileComparison,
  CandidateFileStatus,
};

export const MAX_PAGE_SIZE = 50;
export const DEFAULT_PAGE_SIZE = 10;

/**
 * Generates an opaque, non-zero 256-bit certificate identifier (`bytes32`)
 * using cryptographically secure random entropy (crypto.getRandomValues).
 */
export function generateCertificateId(): Hex {
  const bytes = new Uint8Array(32);
  let isZero = true;

  while (isZero) {
    if (typeof globalThis !== 'undefined' && globalThis.crypto) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      throw new Error('Cryptographically secure random number generator is unavailable.');
    }

    for (let i = 0; i < 32; i++) {
      if (bytes[i] !== 0) {
        isZero = false;
        break;
      }
    }
  }

  return toHex(bytes);
}

/**
 * Checks whether a certificate ID is available (not yet registered) on-chain.
 */
export async function checkCertificateIdAvailable(
  client: PublicClient,
  registryAddress: Address,
  certId: Hex
): Promise<boolean> {
  const exists = await client.readContract({
    address: registryAddress,
    abi: CertProofRegistryABI,
    functionName: 'certificateExists',
    args: [certId],
  });
  return !exists;
}

export type RegistrationSimulationErrorType =
  | 'ALREADY_REGISTERED'
  | 'CERT_ID_EXISTS'
  | 'UNAUTHORIZED_ISSUER'
  | 'SIMULATION_ERROR';

export interface RegistrationSimulationResult {
  success: boolean;
  errorType?: RegistrationSimulationErrorType;
  errorReason?: string;
}

/**
 * Simulates registerCertificate against the smart contract to evaluate contract duplicate
 * and authorization rules before prompting the user for a wallet transaction.
 *
 * NOTE: Smart contract execution remains the final authority.
 */
export async function simulateCertificateRegistration(
  client: PublicClient,
  registryAddress: Address,
  certId: Hex,
  documentHash: Hex,
  account: Address
): Promise<RegistrationSimulationResult> {
  try {
    await client.simulateContract({
      address: registryAddress,
      abi: CertProofRegistryABI,
      functionName: 'registerCertificate',
      args: [certId, documentHash],
      account,
    });
    return { success: true };
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const errAny = err as Record<string, unknown> | null;

    // Check for custom contract errors
    const errorName =
      (errAny?.data as { errorName?: string })?.errorName ||
      (errAny?.cause as { data?: { errorName?: string } })?.data?.errorName ||
      '';

    if (
      errorName === 'CertProof__AlreadyRegistered' ||
      errMessage.includes('CertProof__AlreadyRegistered')
    ) {
      return {
        success: false,
        errorType: 'ALREADY_REGISTERED',
        errorReason:
          'This document hash has already been registered by your wallet. Duplicate registrations by the same issuer are permanently prohibited, even if revoked.',
      };
    }

    if (
      errorName === 'CertProof__CertIdAlreadyExists' ||
      errMessage.includes('CertProof__CertIdAlreadyExists')
    ) {
      return {
        success: false,
        errorType: 'CERT_ID_EXISTS',
        errorReason:
          'Certificate ID collision detected. A new unique opaque ID must be generated.',
      };
    }

    if (
      errorName === 'CertProof__UnauthorizedIssuer' ||
      errMessage.includes('CertProof__UnauthorizedIssuer')
    ) {
      return {
        success: false,
        errorType: 'UNAUTHORIZED_ISSUER',
        errorReason:
          'Your connected wallet is not currently authorized to register credentials in the registry contract.',
      };
    }

    return {
      success: false,
      errorType: 'SIMULATION_ERROR',
      errorReason: errMessage,
    };
  }
}

export interface ReceiptVerificationResult {
  verified: boolean;
  error?: string;
  registeredAt?: number;
  logIndex?: number;
}

/**
 * Verifies transaction receipt and matching CertificateRegistered event:
 * 1. Confirms receipt status === 'success'.
 * 2. Parses event logs for CertificateRegistered.
 * 3. Confirms log was emitted by the expected registry contract address.
 * 4. Verifies exact expected certId, issuer address, and documentHash.
 *
 * Does NOT derive certId from global counters or unrelated events.
 */
export function verifyCertificateRegisteredReceipt(
  receipt: TransactionReceipt,
  registryAddress: Address,
  expected: {
    certId: Hex;
    issuer: Address;
    documentHash: Hex;
  }
): ReceiptVerificationResult {
  if (receipt.status !== 'success') {
    return {
      verified: false,
      error: 'Transaction failed or was reverted on-chain.',
    };
  }

  // Parse logs emitted by the contract
  const logs = parseEventLogs({
    abi: CertProofRegistryABI,
    logs: receipt.logs,
    eventName: 'CertificateRegistered',
  });

  const matchingLog = logs.find((log) => {
    const isRegistry = log.address.toLowerCase() === registryAddress.toLowerCase();
    const isCertMatch = log.args.certId.toLowerCase() === expected.certId.toLowerCase();
    const isIssuerMatch = log.args.issuer.toLowerCase() === expected.issuer.toLowerCase();
    const isDocMatch =
      log.args.documentHash.toLowerCase() === expected.documentHash.toLowerCase();

    return isRegistry && isCertMatch && isIssuerMatch && isDocMatch;
  });

  if (!matchingLog) {
    return {
      verified: false,
      error:
        'Matching CertificateRegistered event not found in receipt. The transaction may not have registered the expected certificate.',
    };
  }

  return {
    verified: true,
    registeredAt: Number(matchingLog.args.registeredAt),
    logIndex: matchingLog.logIndex,
  };
}

/**
 * Fetches a bounded, paginated slice of certificates issued by the given address directly from the contract.
 *
 * Pagination Semantics:
 * - Contract function: getIssuerCertificates(address, offset, limit)
 * - MAX_PAGE_SIZE: 50 (contract enforces limit > 0 && limit <= 50)
 * - Slices are strictly ordered chronologically (0 is oldest).
 * - Revoked certificates remain in history and are included.
 * - For each item, reads getCertificate() and current isIssuerAuthorized().
 */
export async function fetchIssuerCertificates(
  client: PublicClient,
  registryAddress: Address,
  issuer: Address,
  offset: bigint,
  limit: bigint = BigInt(DEFAULT_PAGE_SIZE)
): Promise<{
  items: IssuerCertificateItem[];
  total: number;
  nextOffset: number;
}> {
  if (limit === 0n || limit > BigInt(MAX_PAGE_SIZE)) {
    throw new Error(
      `Invalid page limit ${limit}. Limit must be between 1 and ${MAX_PAGE_SIZE}.`
    );
  }

  // 1. Query bounded slice of certIds from getIssuerCertificates
  const [certIds, nextOffset, total] = await client.readContract({
    address: registryAddress,
    abi: CertProofRegistryABI,
    functionName: 'getIssuerCertificates',
    args: [issuer, offset, limit],
  });

  if (!certIds || certIds.length === 0) {
    return {
      items: [],
      total: Number(total),
      nextOffset: Number(nextOffset),
    };
  }

  // 2. Query each certificate record and current issuer authorization
  const items: IssuerCertificateItem[] = await Promise.all(
    certIds.map(async (certId) => {
      const record = await client.readContract({
        address: registryAddress,
        abi: CertProofRegistryABI,
        functionName: 'getCertificate',
        args: [certId],
      });

      const isAuthorized = await client.readContract({
        address: registryAddress,
        abi: CertProofRegistryABI,
        functionName: 'isIssuerAuthorized',
        args: [record.issuer],
      });

      return {
        certId: record.certId,
        documentHash: record.documentHash,
        issuer: record.issuer,
        registeredAt: Number(record.registeredAt),
        revokedAt: Number(record.revokedAt),
        revoked: record.revoked,
        isIssuerCurrentlyAuthorized: Boolean(isAuthorized),
      };
    })
  );

  return {
    items,
    total: Number(total),
    nextOffset: Number(nextOffset),
  };
}

export type RevocationSimulationErrorType =
  | 'CERTIFICATE_NOT_FOUND'
  | 'NOT_CERTIFICATE_ISSUER'
  | 'ALREADY_REVOKED'
  | 'SIMULATION_ERROR';

export interface RevocationSimulationResult {
  success: boolean;
  errorType?: RevocationSimulationErrorType;
  errorReason?: string;
}

/**
 * Simulates revokeCertificate against the smart contract after re-reading the
 * authoritative on-chain state to confirm existence, issuer identity, and active status.
 */
export async function simulateCertificateRevocation(
  client: PublicClient,
  registryAddress: Address,
  certId: Hex,
  account: Address
): Promise<RevocationSimulationResult> {
  try {
    // 1. Direct on-chain pre-check of current certificate state
    const record = await client.readContract({
      address: registryAddress,
      abi: CertProofRegistryABI,
      functionName: 'getCertificate',
      args: [certId],
    });

    if (record.registeredAt === 0n) {
      return {
        success: false,
        errorType: 'CERTIFICATE_NOT_FOUND',
        errorReason: 'Certificate not found in the registry contract.',
      };
    }

    if (record.issuer.toLowerCase() !== account.toLowerCase()) {
      return {
        success: false,
        errorType: 'NOT_CERTIFICATE_ISSUER',
        errorReason:
          'Access denied: Only the original issuing wallet can revoke this certificate.',
      };
    }

    if (record.revoked) {
      return {
        success: false,
        errorType: 'ALREADY_REVOKED',
        errorReason:
          'This certificate has already been permanently revoked on-chain.',
      };
    }

    // 2. Simulate contract execution
    await client.simulateContract({
      address: registryAddress,
      abi: CertProofRegistryABI,
      functionName: 'revokeCertificate',
      args: [certId],
      account,
    });

    return { success: true };
  } catch (err: unknown) {
    const errMessage = err instanceof Error ? err.message : String(err);
    const errAny = err as Record<string, unknown> | null;

    const errorName =
      (errAny?.data as { errorName?: string })?.errorName ||
      (errAny?.cause as { data?: { errorName?: string } })?.data?.errorName ||
      '';

    if (
      errorName === 'CertProof__CertificateNotFound' ||
      errMessage.includes('CertProof__CertificateNotFound')
    ) {
      return {
        success: false,
        errorType: 'CERTIFICATE_NOT_FOUND',
        errorReason: 'Certificate not found in registry contract.',
      };
    }

    if (
      errorName === 'CertProof__NotCertificateIssuer' ||
      errMessage.includes('CertProof__NotCertificateIssuer')
    ) {
      return {
        success: false,
        errorType: 'NOT_CERTIFICATE_ISSUER',
        errorReason:
          'Access denied: Only the original issuing wallet can revoke this certificate.',
      };
    }

    if (
      errorName === 'CertProof__AlreadyRevoked' ||
      errMessage.includes('CertProof__AlreadyRevoked')
    ) {
      return {
        success: false,
        errorType: 'ALREADY_REVOKED',
        errorReason:
          'This certificate has already been permanently revoked on-chain.',
      };
    }

    return {
      success: false,
      errorType: 'SIMULATION_ERROR',
      errorReason: errMessage,
    };
  }
}

export interface RevocationReceiptVerificationResult {
  verified: boolean;
  error?: string;
  revokedAt?: number;
  logIndex?: number;
}

/**
 * Verifies transaction receipt and matching CertificateRevoked event:
 * 1. Confirms receipt status === 'success'.
 * 2. Parses event logs for CertificateRevoked.
 * 3. Confirms log was emitted by the expected registry contract address.
 * 4. Verifies exact expected certId and issuer address.
 *
 * Does NOT claim success merely because another transaction revoked the certificate.
 */
export function verifyCertificateRevokedReceipt(
  receipt: TransactionReceipt,
  registryAddress: Address,
  expected: {
    certId: Hex;
    issuer: Address;
  }
): RevocationReceiptVerificationResult {
  if (receipt.status !== 'success') {
    return {
      verified: false,
      error: 'Transaction failed or was reverted on-chain.',
    };
  }

  // Parse logs emitted by the contract
  const logs = parseEventLogs({
    abi: CertProofRegistryABI,
    logs: receipt.logs,
    eventName: 'CertificateRevoked',
  });

  const matchingLog = logs.find((log) => {
    const isRegistry = log.address.toLowerCase() === registryAddress.toLowerCase();
    const isCertMatch = log.args.certId.toLowerCase() === expected.certId.toLowerCase();
    const isIssuerMatch = log.args.issuer.toLowerCase() === expected.issuer.toLowerCase();

    return isRegistry && isCertMatch && isIssuerMatch;
  });

  if (!matchingLog) {
    return {
      verified: false,
      error:
        'Matching CertificateRevoked event not found in receipt. The transaction may not have revoked the expected certificate.',
    };
  }

  return {
    verified: true,
    revokedAt: Number(matchingLog.args.revokedAt),
    logIndex: matchingLog.logIndex,
  };
}

/**
 * Directly reconciles the authoritative certificate state from the contract
 * after confirmed revocation, verifying that revoked is true and registration
 * parameters remain intact.
 */
export async function reconcileRevokedCertificate(
  client: PublicClient,
  registryAddress: Address,
  certId: Hex
): Promise<IssuerCertificateItem> {
  const record = await client.readContract({
    address: registryAddress,
    abi: CertProofRegistryABI,
    functionName: 'getCertificate',
    args: [certId],
  });

  const isAuthorized = await client.readContract({
    address: registryAddress,
    abi: CertProofRegistryABI,
    functionName: 'isIssuerAuthorized',
    args: [record.issuer],
  });

  return {
    certId: record.certId,
    documentHash: record.documentHash,
    issuer: record.issuer,
    registeredAt: Number(record.registeredAt),
    revokedAt: Number(record.revokedAt),
    revoked: record.revoked,
    isIssuerCurrentlyAuthorized: Boolean(isAuthorized),
  };
}

/**
 * Validates that an untrusted string is a valid bytes32 hexadecimal string (66 chars, 0x-prefixed, non-zero).
 */
export function isValidCertId(id: string): id is Hex {
  if (typeof id !== 'string') return false;
  if (!/^0x[0-9a-fA-F]{64}$/.test(id)) return false;
  // Non-zero check (contract reverts with CertProof__InvalidCertId on bytes32(0))
  if (/^0x0{64}$/i.test(id)) return false;
  return true;
}

/**
 * Reads certificate existence, immutable registration fields, revocation status,
 * and current issuer authorization directly from the registry contract using a consistent block snapshot.
 *
 * Strict public verifier semantics:
 * - Scopes certificate identity to chain ID, registry address, and certificate ID.
 * - Rejects malformed IDs without dispatching RPC requests.
 * - Rejects unsupported deployments if requested chain or registry differs from configured deployment.
 * - Detects missing deployments when bytecode is absent at configured address.
 * - Pins read operations to an observed block snapshot (blockNumber) for consistency.
 * - Explicitly distinguishes RPC failures from "unregistered", "not revoked", or "authorized".
 * - Never requires wallet connection, SIWE session, or MongoDB database access.
 */
export async function fetchPublicCertificate(
  client: PublicClient,
  registryAddress: Address,
  certId: string,
  options?: {
    expectedChainId?: number;
    requestedChainId?: number;
    requestedRegistry?: string;
  }
): Promise<PublicCertificateReadResult> {
  const chainId = options?.expectedChainId ?? 31337;

  // 1. Check requested deployment parameters if provided in route or query
  if (
    options?.requestedChainId !== undefined &&
    !Number.isNaN(options.requestedChainId) &&
    options.requestedChainId !== chainId
  ) {
    return {
      status: 'UNSUPPORTED_DEPLOYMENT',
      chainId,
      registryAddress,
      errorMessage: `Unsupported chain ID ${options.requestedChainId}. This verifier is configured for chain ID ${chainId}.`,
    };
  }

  if (
    options?.requestedRegistry !== undefined &&
    options.requestedRegistry.trim() !== '' &&
    options.requestedRegistry.toLowerCase() !== registryAddress.toLowerCase()
  ) {
    return {
      status: 'UNSUPPORTED_DEPLOYMENT',
      chainId,
      registryAddress,
      errorMessage: `Unsupported registry address ${options.requestedRegistry}. This verifier is configured for registry ${registryAddress}.`,
    };
  }

  // 2. Format validation: must be valid non-zero 32-byte hex string
  if (!isValidCertId(certId)) {
    return {
      status: 'MALFORMED_ID',
      chainId,
      registryAddress,
      errorMessage:
        'Invalid Certificate ID: Expected a 66-character hexadecimal string (32-byte non-zero identifier).',
    };
  }

  const validCertId = certId as Hex;

  try {
    // 3. Obtain current block snapshot (cacheTime: 0 ensures instantaneous RPC read on freshly mined blocks)
    const blockNumber = await client.getBlockNumber({ cacheTime: 0 });

    // 4. Verify deployment bytecode exists at registryAddress
    const code = await client.getBytecode({
      address: registryAddress,
      blockNumber,
    });

    if (!code || code === '0x') {
      return {
        status: 'MISSING_DEPLOYMENT',
        certId: validCertId,
        chainId,
        registryAddress,
        blockNumber,
        errorMessage: `No smart contract bytecode deployed at configured registry address ${registryAddress} on chain ${chainId}.`,
      };
    }

    // 5. Query certificate record using block snapshot
    const record = await client.readContract({
      address: registryAddress,
      abi: CertProofRegistryABI,
      functionName: 'getCertificate',
      args: [validCertId],
      blockNumber,
    });

    if (record.registeredAt === 0n) {
      return {
        status: 'UNREGISTERED',
        certId: validCertId,
        chainId,
        registryAddress,
        blockNumber,
      };
    }

    // 6. Query issuer authorization at identical block snapshot
    const isAuthorized = await client.readContract({
      address: registryAddress,
      abi: CertProofRegistryABI,
      functionName: 'isIssuerAuthorized',
      args: [record.issuer],
      blockNumber,
    });

    return {
      status: 'REGISTERED',
      certId: record.certId,
      chainId,
      registryAddress,
      blockNumber,
      record: {
        certId: record.certId,
        documentHash: record.documentHash,
        issuer: record.issuer,
        registeredAt: Number(record.registeredAt),
        revokedAt: Number(record.revokedAt),
        revoked: record.revoked,
      },
      isIssuerCurrentlyAuthorized: Boolean(isAuthorized),
    };
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      status: 'RPC_ERROR',
      certId: validCertId,
      chainId,
      registryAddress,
      errorMessage: `Ethereum node RPC communication error: ${errMsg}. Do not interpret this network failure as an unregistered or revoked status.`,
    };
  }
}


