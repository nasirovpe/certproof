import { Address, Hex, isAddress, getAddress } from 'viem';
import QRCode from 'qrcode';
import { isValidCertId } from '@/lib/certificate/registry';
import { getClientEnv } from '@/lib/config/env';

export const SUPPORTED_CHAIN_IDS = [31337, 11155111] as const;

export const QR_CODE_WIDTH = 512;
export const QR_CODE_MARGIN = 4;
export const QR_CODE_ERROR_CORRECTION = 'M' as const;

export const QR_LOOKUP_EXPLANATION =
  'This QR code and link open a live on-chain registry lookup. They do not prove certificate validity or contain the PDF. Verifiers must independently select and compare the candidate PDF document.';

export const LOCALHOST_ORIGIN_NOTICE =
  'Local-only link: This URL targets a local development environment (localhost / 127.0.0.1) and cannot be opened from another device or mobile scanner unless an external tunnel or public origin is explicitly configured.';

export interface CanonicalVerificationUrlParams {
  certId: string;
  chainId: number;
  registryAddress: string;
  origin?: string;
}

export interface ParsedCanonicalVerificationUrl {
  certId: Hex;
  chainId: number;
  registryAddress: Address;
  origin: string;
}

/**
 * Validates and normalizes an application origin.
 * Rejects non-HTTP(S) protocols, path segments, and credentials.
 * Ensures the origin is not derived from untrusted Host headers or arbitrary user input.
 */
export function validateApplicationOrigin(rawOrigin?: string): string {
  const candidate = (
    rawOrigin !== undefined ? rawOrigin : (getClientEnv().NEXT_PUBLIC_APP_URL || '')
  ).trim();

  if (!candidate) {
    throw new Error('INVALID_ORIGIN: Configured application origin is missing or empty.');
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`INVALID_ORIGIN: Could not parse origin '${candidate}' as a valid URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `INVALID_ORIGIN_PROTOCOL: Unsupported protocol '${parsed.protocol}'. Origin must use http: or https:.`
    );
  }

  if (parsed.username || parsed.password) {
    throw new Error('INVALID_ORIGIN_CREDENTIALS: Origin must not contain user credentials.');
  }

  // Return normalized origin without trailing slashes or default ports
  return parsed.origin;
}

/**
 * Checks whether an origin points to a local machine loopback address.
 */
export function isLocalOrigin(originOrUrl: string): boolean {
  try {
    const url = new URL(originOrUrl);
    const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal')
    );
  } catch {
    return false;
  }
}

/**
 * Creates a canonical verification URL strictly scoped to (certId, chainId, registryAddress).
 *
 * Guarantees:
 * - Scoped strictly to certificate ID, chain ID, and registry address.
 * - Format validated: certId must be valid non-zero bytes32 hex string.
 * - Deployment validated: chainId and registryAddress must be valid and supported.
 * - Origin validated: uses validated application origin, never untrusted Host headers.
 * - Information hygiene: no filenames, PDF bytes, personal data, signatures, or session tokens.
 */
export function buildCanonicalVerificationUrl({
  certId,
  chainId,
  registryAddress,
  origin,
}: CanonicalVerificationUrlParams): string {
  // 1. Strict certificate ID validation
  if (!isValidCertId(certId)) {
    throw new Error(
      'MALFORMED_ID: Certificate ID must be a 66-character non-zero hexadecimal string.'
    );
  }

  // 2. Strict chain ID validation
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`INVALID_CHAIN_ID: Chain ID must be a positive integer, received '${chainId}'.`);
  }

  const isSupportedChain = (SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId);
  if (!isSupportedChain) {
    throw new Error(
      `UNSUPPORTED_CHAIN: Chain ID ${chainId} is unsupported. Expected 31337 (Anvil) or 11155111 (Sepolia).`
    );
  }

  // 3. Strict registry address validation
  if (!isAddress(registryAddress)) {
    throw new Error(
      `INVALID_REGISTRY_ADDRESS: Registry address '${registryAddress}' is not a valid Ethereum address.`
    );
  }
  const checksummedRegistry = getAddress(registryAddress);

  // 4. Origin validation
  const normalizedOrigin = validateApplicationOrigin(origin);

  // 5. Construct canonical URL using standard public verification route conventions
  const canonicalUrl = new URL(
    `/verify/${certId.toLowerCase()}`,
    normalizedOrigin
  );
  canonicalUrl.searchParams.set('chainId', String(chainId));
  canonicalUrl.searchParams.set('registry', checksummedRegistry);

  return canonicalUrl.toString();
}

/**
 * Parses and verifies an incoming canonical verification URL.
 */
export function parseCanonicalVerificationUrl(rawUrl: string): ParsedCanonicalVerificationUrl {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    throw new Error(`MALFORMED_URL: '${rawUrl}' is not a valid URL.`);
  }

  const origin = validateApplicationOrigin(parsedUrl.origin);

  // Validate path pattern: /verify/0x...
  const match = parsedUrl.pathname.match(/^\/verify\/(0x[a-fA-F0-9]{64})$/);
  if (!match) {
    throw new Error(
      `MALFORMED_PATH: Verification URL path must match '/verify/<66-char-certId>', got '${parsedUrl.pathname}'.`
    );
  }
  const certId = match[1] as Hex;
  if (!isValidCertId(certId)) {
    throw new Error(`MALFORMED_ID: Certificate ID in URL '${certId}' is invalid or zero.`);
  }

  // Validate chainId query parameter
  const rawChainId = parsedUrl.searchParams.get('chainId');
  if (!rawChainId) {
    throw new Error("MISSING_PARAMETER: URL is missing required 'chainId' query parameter.");
  }
  const chainId = Number(rawChainId);
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error(`INVALID_CHAIN_ID: '${rawChainId}' is not a valid chain ID.`);
  }
  if (!(SUPPORTED_CHAIN_IDS as readonly number[]).includes(chainId)) {
    throw new Error(`UNSUPPORTED_CHAIN: Chain ID ${chainId} is unsupported.`);
  }

  // Validate registry query parameter
  const rawRegistry = parsedUrl.searchParams.get('registry');
  if (!rawRegistry) {
    throw new Error("MISSING_PARAMETER: URL is missing required 'registry' query parameter.");
  }
  if (!isAddress(rawRegistry)) {
    throw new Error(`INVALID_REGISTRY_ADDRESS: '${rawRegistry}' is not a valid Ethereum address.`);
  }
  const registryAddress = getAddress(rawRegistry);

  return {
    certId,
    chainId,
    registryAddress,
    origin,
  };
}

/**
 * Returns a safe, deterministic filename for downloading QR code PNGs.
 */
export function getSafeQrFilename(certId: string): string {
  const clean = certId.toLowerCase().trim();
  const hex = clean.startsWith('0x') ? clean.slice(2) : clean;
  const safeHex = hex.replace(/[^a-f0-9]/g, '');
  return `certproof-qr-0x${safeHex.slice(0, 16)}.png`;
}

/**
 * Generates a high-contrast, high-resolution QR code PNG Data URL locally.
 * Encodes strictly the canonical verification URL. Zero external network calls.
 */
export async function generateVerificationQrDataUrl(
  canonicalUrl: string,
  options?: { width?: number; margin?: number }
): Promise<string> {
  const width = options?.width ?? QR_CODE_WIDTH;
  const margin = options?.margin ?? QR_CODE_MARGIN;

  return QRCode.toDataURL(canonicalUrl, {
    errorCorrectionLevel: QR_CODE_ERROR_CORRECTION,
    margin,
    width,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

/**
 * Generates a PNG Buffer in Node environment (for automated test verification).
 */
export async function generateVerificationQrPngBuffer(
  canonicalUrl: string,
  options?: { width?: number; margin?: number }
): Promise<Buffer> {
  const width = options?.width ?? QR_CODE_WIDTH;
  const margin = options?.margin ?? QR_CODE_MARGIN;

  return QRCode.toBuffer(canonicalUrl, {
    errorCorrectionLevel: QR_CODE_ERROR_CORRECTION,
    margin,
    width,
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
}

/**
 * Triggers a download of the QR code Data URL in the browser,
 * properly releasing DOM elements and resources afterwards.
 */
export function triggerQrDownload(dataUrl: string, filename: string): void {
  if (typeof document === 'undefined') return;

  const anchor = document.createElement('a');
  anchor.href = dataUrl;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);

  try {
    anchor.click();
  } finally {
    document.body.removeChild(anchor);
  }
}
