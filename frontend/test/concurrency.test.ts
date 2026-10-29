import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initTestDb, closeTestClient, clearTestDb } from './setup';
import { createSiweChallenge, verifySiweChallenge } from '@/lib/auth/siwe';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';

const TEST_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);

describe('Atomic Concurrency & Anti-Replay Verification', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  afterAll(async () => {
    await closeTestClient();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  it('ensures concurrent nonce redemption produces strictly one successful verification', async () => {
    // 1. Create a single challenge
    const challenge = await createSiweChallenge(31337);

    // 2. Prepare SIWE message and signature
    const siweMessage = new SiweMessage({
      domain: 'localhost:3000',
      address: testAccount.address,
      statement: 'Concurrent redemption test',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 31337,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message: messageText });

    // 3. Fire 15 simultaneous verification requests concurrently
    const CONCURRENCY_COUNT = 15;
    const tasks = Array.from({ length: CONCURRENCY_COUNT }, () =>
      verifySiweChallenge({
        message: messageText,
        signature,
        browserBindingToken: challenge.browserBindingToken,
        requestOrigin: 'http://localhost:3000',
      })
    );

    const results = await Promise.all(tasks);

    // 4. Assert: Exactly ONE request succeeds; all others fail
    const successfulAttempts = results.filter((r) => r.success);
    const failedAttempts = results.filter((r) => !r.success);

    expect(successfulAttempts.length).toBe(1);
    expect(failedAttempts.length).toBe(CONCURRENCY_COUNT - 1);

    for (const fail of failedAttempts) {
      expect(fail.errorCode).toBe('INVALID_CHALLENGE');
    }
  });
});
