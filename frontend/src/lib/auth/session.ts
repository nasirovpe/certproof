import crypto from 'node:crypto';
import { getDb, ensureIndexes } from '../db/mongodb';
import { COLLECTIONS, ISession } from '../db/collections';
import { hashToken } from './siwe';

export const SESSION_COOKIE_NAME = 'certproof_session';
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface SessionData {
  walletAddress: string;
  chainId: number;
  expiresAt: Date;
}

export interface CreatedSession extends SessionData {
  token: string;
}

/**
 * Creates a server-side session, rotates any prior session, and stores only the token hash.
 */
export async function createSession(
  walletAddress: string,
  chainId: number,
  priorToken?: string,
  userAgent?: string
): Promise<CreatedSession> {
  await ensureIndexes();
  const db = await getDb();
  const sessionsCol = db.collection<ISession>(COLLECTIONS.SESSIONS);

  // Rotate session: invalidate prior session token if provided
  if (priorToken) {
    const priorHash = hashToken(priorToken);
    await sessionsCol.deleteOne({ sessionTokenHash: priorHash });
  }

  const rawToken = crypto.randomBytes(32).toString('hex');
  const sessionTokenHash = hashToken(rawToken);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);

  const sessionDoc: ISession = {
    sessionTokenHash,
    walletAddress: walletAddress.toLowerCase(),
    chainId,
    issuedAt: now,
    expiresAt,
    lastActiveAt: now,
    userAgent,
  };

  await sessionsCol.insertOne(sessionDoc);

  return {
    token: rawToken,
    walletAddress: sessionDoc.walletAddress,
    chainId,
    expiresAt,
  };
}

/**
 * Retrieves and validates an active server session.
 * Enforces explicit expiration check in application logic.
 */
export async function getSession(rawToken?: string): Promise<SessionData | null> {
  if (!rawToken || typeof rawToken !== 'string') {
    return null;
  }

  await ensureIndexes();
  const db = await getDb();
  const tokenHash = hashToken(rawToken);

  const sessionsCol = db.collection<ISession>(COLLECTIONS.SESSIONS);
  const sessionDoc = await sessionsCol.findOne({ sessionTokenHash: tokenHash });

  if (!sessionDoc) {
    return null;
  }

  // Application-level expiration check (never rely solely on background MongoDB TTL)
  const now = new Date();
  if (sessionDoc.expiresAt.getTime() <= now.getTime()) {
    await sessionsCol.deleteOne({ sessionTokenHash: tokenHash });
    return null;
  }

  // Update lastActiveAt periodically (best-effort)
  await sessionsCol.updateOne(
    { _id: sessionDoc._id },
    { $set: { lastActiveAt: now } }
  );

  return {
    walletAddress: sessionDoc.walletAddress,
    chainId: sessionDoc.chainId,
    expiresAt: sessionDoc.expiresAt,
  };
}

/**
 * Permanently destroys a session by invalidating its token hash.
 */
export async function destroySession(rawToken?: string): Promise<void> {
  if (!rawToken) return;

  await ensureIndexes();
  const db = await getDb();
  const tokenHash = hashToken(rawToken);

  await db.collection<ISession>(COLLECTIONS.SESSIONS).deleteOne({ sessionTokenHash: tokenHash });
}

export function getSessionCookieOptions(expiresAt: Date) {
  const isProd = process.env.NODE_ENV === 'production';
  const secure = process.env.COOKIE_SECURE !== undefined
    ? (process.env.COOKIE_SECURE === 'true' || process.env.COOKIE_SECURE === '1')
    : isProd;
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}
