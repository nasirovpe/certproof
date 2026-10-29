import { PendingRegistrationDraft, PendingRevocationDraft } from './types';

export const PENDING_REGISTRATION_STORAGE_KEY = 'certproof_pending_registration';
export const PENDING_REVOCATION_STORAGE_KEY = 'certproof_pending_revocation';

const BYTES32_REGEX = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

/**
 * Saves minimal non-sensitive operation metadata to sessionStorage for refresh recovery.
 *
 * ZERO-DATA LEAK RULE:
 * NEVER store PDF bytes, filenames, signatures, session tokens, or private document contents.
 */
export function savePendingRegistration(draft: PendingRegistrationDraft): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }

  // Sanitize and ensure only minimal non-sensitive fields are written
  const minimalData: PendingRegistrationDraft = {
    certId: draft.certId,
    documentHash: draft.documentHash,
    issuerAddress: draft.issuerAddress.toLowerCase() as `0x${string}`,
    chainId: draft.chainId,
    registryAddress: draft.registryAddress.toLowerCase() as `0x${string}`,
    stage: draft.stage,
    timestamp: draft.timestamp,
  };

  if (draft.txHash) {
    minimalData.txHash = draft.txHash;
  }

  try {
    window.sessionStorage.setItem(
      PENDING_REGISTRATION_STORAGE_KEY,
      JSON.stringify(minimalData)
    );
  } catch (err) {
    console.warn('[STORAGE] Failed to save pending registration metadata to sessionStorage:', err);
  }
}

/**
 * Updates the existing pending draft in sessionStorage with the broadcasted transaction hash.
 */
export function updatePendingRegistrationTxHash(txHash: `0x${string}`): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_REGISTRATION_STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    data.txHash = txHash;
    data.stage = 'submitted';
    window.sessionStorage.setItem(
      PENDING_REGISTRATION_STORAGE_KEY,
      JSON.stringify(data)
    );
  } catch (err) {
    console.warn('[STORAGE] Failed to update txHash in sessionStorage:', err);
  }
}

/**
 * Loads pending registration metadata from sessionStorage.
 *
 * UNTRUSTED DATA VALIDATION & SCOPING:
 * 1. Validates strict schema and hexadecimal regexes for certId, docHash, and addresses.
 * 2. Scopes recovery to the active wallet account, active chain ID, and configured registry contract.
 * 3. Never restores another account's or another chain's pending operation.
 * 4. Returns null if data is absent, corrupt, or out-of-scope.
 */
export function loadPendingRegistration(scope: {
  issuerAddress: string;
  chainId: number;
  registryAddress: string;
}): PendingRegistrationDraft | null {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_REGISTRATION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    // Strict validation
    if (!parsed || typeof parsed !== 'object') return null;

    if (typeof parsed.certId !== 'string' || !BYTES32_REGEX.test(parsed.certId)) {
      return null;
    }
    if (typeof parsed.documentHash !== 'string' || !BYTES32_REGEX.test(parsed.documentHash)) {
      return null;
    }
    if (typeof parsed.issuerAddress !== 'string' || !ADDRESS_REGEX.test(parsed.issuerAddress)) {
      return null;
    }
    if (typeof parsed.chainId !== 'number' || !Number.isInteger(parsed.chainId)) {
      return null;
    }
    if (typeof parsed.registryAddress !== 'string' || !ADDRESS_REGEX.test(parsed.registryAddress)) {
      return null;
    }
    if (parsed.stage !== 'prepared' && parsed.stage !== 'submitted') {
      return null;
    }
    if (typeof parsed.timestamp !== 'number') {
      return null;
    }
    if (parsed.txHash !== undefined) {
      if (typeof parsed.txHash !== 'string' || !BYTES32_REGEX.test(parsed.txHash)) {
        return null;
      }
    }

    // Account, Chain, and Contract Scoping Checks
    if (parsed.issuerAddress.toLowerCase() !== scope.issuerAddress.toLowerCase()) {
      return null;
    }
    if (parsed.chainId !== scope.chainId) {
      return null;
    }
    if (parsed.registryAddress.toLowerCase() !== scope.registryAddress.toLowerCase()) {
      return null;
    }

    return parsed as PendingRegistrationDraft;
  } catch {
    return null;
  }
}

/**
 * Purges the pending registration draft from sessionStorage.
 */
export function clearPendingRegistration(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }

  try {
    window.sessionStorage.removeItem(PENDING_REGISTRATION_STORAGE_KEY);
  } catch (err) {
    console.warn('[STORAGE] Failed to clear pending registration from sessionStorage:', err);
  }
}

// ============================================================================
// PENDING REVOCATION STORAGE RECOVERY
// ============================================================================

/**
 * Saves minimal non-sensitive revocation operation metadata to sessionStorage for refresh recovery.
 *
 * Scoped to operation type ('revocation'), active account, chain, and contract.
 * ZERO-DATA LEAK RULE:
 * NEVER store signatures, session tokens, PDF bytes, or filenames.
 */
export function savePendingRevocation(draft: PendingRevocationDraft): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }

  const minimalData: PendingRevocationDraft = {
    operationType: 'revocation',
    certId: draft.certId,
    documentHash: draft.documentHash,
    issuerAddress: draft.issuerAddress.toLowerCase() as `0x${string}`,
    chainId: draft.chainId,
    registryAddress: draft.registryAddress.toLowerCase() as `0x${string}`,
    stage: draft.stage,
    timestamp: draft.timestamp,
  };

  if (draft.txHash) {
    minimalData.txHash = draft.txHash;
  }

  try {
    window.sessionStorage.setItem(
      PENDING_REVOCATION_STORAGE_KEY,
      JSON.stringify(minimalData)
    );
  } catch (err) {
    console.warn('[STORAGE] Failed to save pending revocation metadata to sessionStorage:', err);
  }
}

/**
 * Updates the existing pending revocation in sessionStorage with the broadcasted transaction hash.
 */
export function updatePendingRevocationTxHash(txHash: `0x${string}`): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_REVOCATION_STORAGE_KEY);
    if (!raw) return;

    const data = JSON.parse(raw);
    data.txHash = txHash;
    data.stage = 'submitted';
    window.sessionStorage.setItem(
      PENDING_REVOCATION_STORAGE_KEY,
      JSON.stringify(data)
    );
  } catch (err) {
    console.warn('[STORAGE] Failed to update revocation txHash in sessionStorage:', err);
  }
}

/**
 * Loads pending revocation metadata from sessionStorage with untrusted data validation & scoping.
 */
export function loadPendingRevocation(scope: {
  issuerAddress: string;
  chainId: number;
  registryAddress: string;
}): PendingRevocationDraft | null {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_REVOCATION_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    // Strict validation
    if (!parsed || typeof parsed !== 'object') return null;

    if (parsed.operationType !== 'revocation') {
      return null;
    }
    if (typeof parsed.certId !== 'string' || !BYTES32_REGEX.test(parsed.certId)) {
      return null;
    }
    if (typeof parsed.documentHash !== 'string' || !BYTES32_REGEX.test(parsed.documentHash)) {
      return null;
    }
    if (typeof parsed.issuerAddress !== 'string' || !ADDRESS_REGEX.test(parsed.issuerAddress)) {
      return null;
    }
    if (typeof parsed.chainId !== 'number' || !Number.isInteger(parsed.chainId)) {
      return null;
    }
    if (typeof parsed.registryAddress !== 'string' || !ADDRESS_REGEX.test(parsed.registryAddress)) {
      return null;
    }
    if (parsed.stage !== 'prepared' && parsed.stage !== 'submitted') {
      return null;
    }
    if (typeof parsed.timestamp !== 'number') {
      return null;
    }
    if (parsed.txHash !== undefined) {
      if (typeof parsed.txHash !== 'string' || !BYTES32_REGEX.test(parsed.txHash)) {
        return null;
      }
    }

    // Scoping Checks
    if (parsed.issuerAddress.toLowerCase() !== scope.issuerAddress.toLowerCase()) {
      return null;
    }
    if (parsed.chainId !== scope.chainId) {
      return null;
    }
    if (parsed.registryAddress.toLowerCase() !== scope.registryAddress.toLowerCase()) {
      return null;
    }

    return parsed as PendingRevocationDraft;
  } catch {
    return null;
  }
}

/**
 * Purges the pending revocation draft from sessionStorage.
 */
export function clearPendingRevocation(): void {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }

  try {
    window.sessionStorage.removeItem(PENDING_REVOCATION_STORAGE_KEY);
  } catch (err) {
    console.warn('[STORAGE] Failed to clear pending revocation from sessionStorage:', err);
  }
}
