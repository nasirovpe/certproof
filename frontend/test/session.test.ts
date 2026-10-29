import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initTestDb, closeTestClient, clearTestDb } from './setup';
import { createSession, getSession, destroySession } from '@/lib/auth/session';
import { hashToken } from '@/lib/auth/siwe';
import { getDb } from '@/lib/db/mongodb';
import { COLLECTIONS, ISession } from '@/lib/db/collections';

describe('MongoDB Server-Side Session Management & Security', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  afterAll(async () => {
    await closeTestClient();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  it('stores only the token hash in MongoDB, never the raw token', async () => {
    const wallet = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase();
    const session = await createSession(wallet, 31337);

    expect(session.token).toBeDefined();
    expect(session.token.length).toBe(64);

    const db = await getDb();
    const sessionDoc = await db.collection<ISession>(COLLECTIONS.SESSIONS).findOne({
      sessionTokenHash: hashToken(session.token),
    });

    expect(sessionDoc).not.toBeNull();
    expect(sessionDoc?.walletAddress).toBe(wallet);

    // Verify raw token does NOT appear in the database document
    const rawSearch = await db.collection(COLLECTIONS.SESSIONS).findOne({
      $or: [
        { sessionTokenHash: session.token },
        { token: session.token },
      ],
    });
    expect(rawSearch).toBeNull();
  });

  it('retrieves an active session correctly', async () => {
    const wallet = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase();
    const session = await createSession(wallet, 31337);

    const retrieved = await getSession(session.token);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.walletAddress).toBe(wallet);
    expect(retrieved?.chainId).toBe(31337);
  });

  it('enforces explicit application-level expiration even if document still exists', async () => {
    const wallet = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase();
    const session = await createSession(wallet, 31337);

    // Manually backdate expiresAt in DB to simulate expired session before background TTL cleanup
    const db = await getDb();
    const tokenHash = hashToken(session.token);
    const expiredDate = new Date(Date.now() - 10_000); // 10 seconds ago

    await db.collection(COLLECTIONS.SESSIONS).updateOne(
      { sessionTokenHash: tokenHash },
      { $set: { expiresAt: expiredDate } }
    );

    // getSession must reject expired session and purge it
    const retrieved = await getSession(session.token);
    expect(retrieved).toBeNull();

    // Verify document was purged
    const docAfter = await db.collection(COLLECTIONS.SESSIONS).findOne({ sessionTokenHash: tokenHash });
    expect(docAfter).toBeNull();
  });

  it('rotates session on new login by invalidating prior session token', async () => {
    const wallet = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase();
    const session1 = await createSession(wallet, 31337);

    // Create session 2 passing prior session 1 token
    const session2 = await createSession(wallet, 31337, session1.token);

    // Session 1 must be invalidated
    const checkSession1 = await getSession(session1.token);
    expect(checkSession1).toBeNull();

    // Session 2 must be valid
    const checkSession2 = await getSession(session2.token);
    expect(checkSession2).not.toBeNull();
    expect(checkSession2?.walletAddress).toBe(wallet);
  });

  it('destroys session on logout', async () => {
    const wallet = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'.toLowerCase();
    const session = await createSession(wallet, 31337);

    await destroySession(session.token);

    const retrieved = await getSession(session.token);
    expect(retrieved).toBeNull();
  });

  it('verifies uniqueness and TTL database indexes', async () => {
    const db = await getDb();

    // Check challenges collection indexes
    const challengeIndexes = await db.collection(COLLECTIONS.CHALLENGES).indexes();
    const nonceIndex = challengeIndexes.find((idx) => idx.key?.nonce === 1);
    const challengeTtlIndex = challengeIndexes.find((idx) => idx.key?.expiresAt === 1);

    expect(nonceIndex?.unique).toBe(true);
    expect(challengeTtlIndex?.expireAfterSeconds).toBe(0);

    // Check sessions collection indexes
    const sessionIndexes = await db.collection(COLLECTIONS.SESSIONS).indexes();
    const sessionTokenIndex = sessionIndexes.find((idx) => idx.key?.sessionTokenHash === 1);
    const sessionTtlIndex = sessionIndexes.find((idx) => idx.key?.expiresAt === 1);

    expect(sessionTokenIndex?.unique).toBe(true);
    expect(sessionTtlIndex?.expireAfterSeconds).toBe(0);
  });
});
