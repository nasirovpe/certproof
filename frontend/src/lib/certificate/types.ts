export interface CertificateRecord {
  certId: `0x${string}`;
  documentHash: `0x${string}`;
  issuer: `0x${string}`;
  registeredAt: bigint;
  revokedAt: bigint;
  revoked: boolean;
}

export interface IssuerCertificateItem {
  certId: `0x${string}`;
  documentHash: `0x${string}`;
  issuer: `0x${string}`;
  registeredAt: number; // Unix timestamp in seconds
  revokedAt: number;
  revoked: boolean;
  isIssuerCurrentlyAuthorized: boolean;
}

export interface PendingRegistrationDraft {
  certId: `0x${string}`;
  documentHash: `0x${string}`;
  issuerAddress: `0x${string}`;
  chainId: number;
  registryAddress: `0x${string}`;
  txHash?: `0x${string}`;
  stage: 'prepared' | 'submitted';
  timestamp: number;
}

export interface PendingRevocationDraft {
  operationType: 'revocation';
  certId: `0x${string}`;
  documentHash: `0x${string}`;
  issuerAddress: `0x${string}`;
  chainId: number;
  registryAddress: `0x${string}`;
  txHash?: `0x${string}`;
  stage: 'prepared' | 'submitted';
  timestamp: number;
}

export type PublicCertificateReadStatus =
  | 'MALFORMED_ID'
  | 'UNSUPPORTED_DEPLOYMENT'
  | 'MISSING_DEPLOYMENT'
  | 'RPC_ERROR'
  | 'UNREGISTERED'
  | 'REGISTERED';

export interface PublicCertificateRecord {
  certId: `0x${string}`;
  documentHash: `0x${string}`;
  issuer: `0x${string}`;
  registeredAt: number;
  revokedAt: number;
  revoked: boolean;
}

export interface PublicCertificateReadResult {
  status: PublicCertificateReadStatus;
  certId?: `0x${string}`;
  chainId: number;
  registryAddress: `0x${string}`;
  blockNumber?: bigint;
  record?: PublicCertificateRecord;
  isIssuerCurrentlyAuthorized?: boolean;
  errorMessage?: string;
}

export type CandidateFileStatus =
  | 'UNCHECKED_NO_FILE'
  | 'HASHING'
  | 'MATCHING'
  | 'MISMATCHING'
  | 'FILE_ERROR';

export interface CandidateFileComparison {
  status: CandidateFileStatus;
  localHash?: `0x${string}`;
  fileName?: string;
  fileSizeBytes?: number;
  errorMessage?: string;
}

