import { MongoClient, Db } from 'mongodb';
import { getServerEnv } from '../config/env';
import { COLLECTIONS, ISiweChallenge, ISession } from './collections';

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

let client: MongoClient;
let clientPromise: Promise<MongoClient>;

export async function getMongoClient(): Promise<MongoClient> {
  const { MONGODB_URI, NODE_ENV } = getServerEnv();

  if (NODE_ENV === 'development') {
    if (!global._mongoClientPromise) {
      client = new MongoClient(MONGODB_URI);
      global._mongoClientPromise = client.connect();
    }
    return global._mongoClientPromise;
  }

  client = new MongoClient(MONGODB_URI);
  return client.connect();
}

export async function getDb(): Promise<Db> {
  const client = await getMongoClient();
  return client.db();
}

let indexesInitialized = false;

export async function ensureIndexes(): Promise<void> {
  if (indexesInitialized) return;

  const db = await getDb();

  // Challenges indexes
  const challengesCol = db.collection<ISiweChallenge>(COLLECTIONS.CHALLENGES);
  await challengesCol.createIndex({ nonce: 1 }, { unique: true });
  await challengesCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  // Sessions indexes
  const sessionsCol = db.collection<ISession>(COLLECTIONS.SESSIONS);
  await sessionsCol.createIndex({ sessionTokenHash: 1 }, { unique: true });
  await sessionsCol.createIndex({ walletAddress: 1 });
  await sessionsCol.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });

  indexesInitialized = true;
}
