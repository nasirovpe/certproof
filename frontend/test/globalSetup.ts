import { execSync } from 'node:child_process';
import { MongoClient } from 'mongodb';

const TEST_MONGO_PORT = 27018;
const TEST_MONGO_URI = `mongodb://127.0.0.1:${TEST_MONGO_PORT}/certproof_test`;

export async function setup() {
  console.log('\n[GlobalSetup] Starting isolated test MongoDB container on port', TEST_MONGO_PORT);

  // Stop any existing container with same name
  try {
    execSync('docker rm -f certproof-test-mongo', { stdio: 'ignore' });
  } catch {
    // ignore
  }

  // Start fresh container
  execSync(`docker run -d --rm --name certproof-test-mongo -p ${TEST_MONGO_PORT}:27017 mongo:7.0`, {
    stdio: 'ignore',
  });

  // Poll until reachable
  let connected = false;
  for (let i = 0; i < 25; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      const client = new MongoClient(TEST_MONGO_URI, {
        serverSelectionTimeoutMS: 1000,
        connectTimeoutMS: 1000,
      });
      await client.connect();
      await client.db('admin').command({ ping: 1 });
      await client.close();
      connected = true;
      console.log('[GlobalSetup] MongoDB is ready and accepting connections.');
      break;
    } catch {
      // retry
    }
  }

  if (!connected) {
    throw new Error('Failed to connect to test MongoDB on port ' + TEST_MONGO_PORT);
  }
}

export async function teardown() {
  console.log('\n[GlobalTeardown] Stopping test MongoDB container...');
  try {
    execSync('docker stop certproof-test-mongo', { stdio: 'ignore' });
  } catch {
    // ignore
  }
}
