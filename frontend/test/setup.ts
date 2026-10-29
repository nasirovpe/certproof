import { getMongoClient, getDb, ensureIndexes } from '@/lib/db/mongodb';
import { COLLECTIONS } from '@/lib/db/collections';

export const TEST_MONGO_PORT = 27018;
export const TEST_MONGO_URI = `mongodb://127.0.0.1:${TEST_MONGO_PORT}/certproof_test`;

process.env.MONGODB_URI = TEST_MONGO_URI;
process.env.SESSION_SECRET = 'test_secret_32_characters_long_random_value_for_testing';
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';
process.env.NEXT_PUBLIC_CHAIN_ID = '31337';

export async function initTestDb(): Promise<void> {
  await clearTestDb();
  await ensureIndexes();
}

export async function clearTestDb(): Promise<void> {
  try {
    const db = await getDb();
    await db.collection(COLLECTIONS.CHALLENGES).deleteMany({});
    await db.collection(COLLECTIONS.SESSIONS).deleteMany({});
  } catch {
    // ignore
  }
}

export async function closeTestClient(): Promise<void> {
  try {
    const client = await getMongoClient();
    await client.close();
  } catch {
    // ignore
  }
}
