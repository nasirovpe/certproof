import crypto from 'node:crypto';
import { generateNonce, SiweMessage } from 'siwe';
import { getDb, ensureIndexes } from '../db/mongodb';
import { COLLECTIONS, ISiweChallenge } from '../db/collections';
import { getServerEnv, getClientEnv } from '../config/env';

export const SIWE_BINDING_COOKIE = 'certproof_siwe_bind';
export const CHALLENGE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export interface CreatedChallenge {
  nonce: string;
  browserBindingToken: string;
  expiresAt: Date;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a single-use SIWE challenge and binds it to the client browser via a random token.
 */
export async function createSiweChallenge(chainId: number): Promise<CreatedChallenge> {
  await ensureIndexes();
  const db = await getDb();

  const nonce = generateNonce();
  const browserBindingToken = crypto.randomBytes(32).toString('hex');
  const browserBindingHash = hashToken(browserBindingToken);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);

  const challengeDoc: ISiweChallenge = {
    nonce,
    browserBindingHash,
    chainId,
    issuedAt: now,
    expiresAt,
    used: false,
  };

  await db.collection<ISiweChallenge>(COLLECTIONS.CHALLENGES).insertOne(challengeDoc);

  return {
    nonce,
    browserBindingToken,
    expiresAt,
  };
}

export interface VerifySiweParams {
  message: string;
  signature: string;
  browserBindingToken?: string;
  requestOrigin?: string;
}

export interface VerifySiweResult {
  success: boolean;
  address?: string;
  chainId?: number;
  error?: string;
  errorCode?: string;
}

/**
 * Validates SIWE challenge atomically and verifies cryptographic signature.
 * Enforces: atomic consumption, exact domain, URI, chain, nonce, browser binding, and expiry.
 */
export async function verifySiweChallenge(params: VerifySiweParams): Promise<VerifySiweResult> {
  const { message, signature, browserBindingToken, requestOrigin } = params;

  if (!message || !signature) {
    return { success: false, error: 'Missing message or signature.', errorCode: 'INVALID_PAYLOAD' };
  }

  if (!browserBindingToken) {
    return { success: false, error: 'Missing browser binding challenge cookie.', errorCode: 'MISSING_BINDING' };
  }

  const clientEnv = getClientEnv();
  const expectedDomain = new URL(clientEnv.NEXT_PUBLIC_APP_URL).host;
  const expectedUri = clientEnv.NEXT_PUBLIC_APP_URL;
  const expectedChainId = clientEnv.NEXT_PUBLIC_CHAIN_ID;

  // Validate CSRF / Origin if provided
  if (requestOrigin) {
    const originHost = new URL(requestOrigin).host;
    if (originHost !== expectedDomain) {
      return { success: false, error: 'Cross-origin request rejected.', errorCode: 'CSRF_REJECTED' };
    }
  }

  // Parse SIWE message
  let siweMessage: SiweMessage;
  try {
    siweMessage = new SiweMessage(message);
  } catch {
    return { success: false, error: 'Malformed SIWE message format.', errorCode: 'MALFORMED_MESSAGE' };
  }

  // Validate domain, URI, and chain ID
  if (siweMessage.domain !== expectedDomain) {
    return { success: false, error: `Invalid domain. Expected ${expectedDomain}, received ${siweMessage.domain}.`, errorCode: 'DOMAIN_MISMATCH' };
  }

  if (!siweMessage.uri.startsWith(expectedUri)) {
    return { success: false, error: `Invalid URI. Expected prefix ${expectedUri}, received ${siweMessage.uri}.`, errorCode: 'URI_MISMATCH' };
  }

  if (siweMessage.chainId !== expectedChainId) {
    return { success: false, error: `Invalid chain ID. Expected ${expectedChainId}, received ${siweMessage.chainId}.`, errorCode: 'CHAIN_MISMATCH' };
  }

  // Atomic Nonce Redemption with Browser Binding Check
  await ensureIndexes();
  const db = await getDb();
  const providedBindingHash = hashToken(browserBindingToken);

  const now = new Date();
  const challengesCol = db.collection<ISiweChallenge>(COLLECTIONS.CHALLENGES);

  // Atomically find unused, unexpired challenge matching nonce and browser binding
  const updatedChallenge = await challengesCol.findOneAndUpdate(
    {
      nonce: siweMessage.nonce,
      browserBindingHash: providedBindingHash,
      used: false,
      expiresAt: { $gt: now },
    },
    {
      $set: {
        used: true,
        usedAt: now,
      },
    },
    { returnDocument: 'after' }
  );

  if (!updatedChallenge) {
    return {
      success: false,
      error: 'Challenge is invalid, expired, replayed, or bound to a different browser session.',
      errorCode: 'INVALID_CHALLENGE',
    };
  }

  // Cryptographic Signature Verification
  try {
    const verification = await siweMessage.verify({
      signature,
      domain: expectedDomain,
      nonce: siweMessage.nonce,
      time: now.toISOString(),
    });

    if (!verification.success) {
      return { success: false, error: 'Cryptographic signature verification failed.', errorCode: 'SIGNATURE_FAILED' };
    }

    const verifiedAddress = siweMessage.address.toLowerCase();

    return {
      success: true,
      address: verifiedAddress,
      chainId: siweMessage.chainId,
    };
  } catch {
    return { success: false, error: 'Signature verification execution error.', errorCode: 'VERIFICATION_ERROR' };
  }
}
