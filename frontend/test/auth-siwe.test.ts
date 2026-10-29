import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initTestDb, closeTestClient, clearTestDb } from './setup';
import { createSiweChallenge, verifySiweChallenge } from '@/lib/auth/siwe';
import { privateKeyToAccount } from 'viem/accounts';
import { SiweMessage } from 'siwe';

const TEST_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const testAccount = privateKeyToAccount(TEST_PRIVATE_KEY);

describe('SIWE Authentication & Challenge Verification', () => {
  beforeAll(async () => {
    await initTestDb();
  });

  afterAll(async () => {
    await closeTestClient();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  it('generates a valid challenge with browser binding and expiry', async () => {
    const challenge = await createSiweChallenge(31337);

    expect(challenge.nonce).toBeDefined();
    expect(challenge.nonce.length).toBeGreaterThanOrEqual(8);
    expect(challenge.browserBindingToken).toBeDefined();
    expect(challenge.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('successfully verifies a valid SIWE signature from a matched browser', async () => {
    const challenge = await createSiweChallenge(31337);

    const siweMessage = new SiweMessage({
      domain: 'localhost:3000',
      address: testAccount.address,
      statement: 'Sign in to CertProof',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 31337,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message: messageText });

    const result = await verifySiweChallenge({
      message: messageText,
      signature,
      browserBindingToken: challenge.browserBindingToken,
      requestOrigin: 'http://localhost:3000',
    });

    expect(result.success).toBe(true);
    expect(result.address).toBe(testAccount.address.toLowerCase());
    expect(result.chainId).toBe(31337);
  });

  it('rejects an invalid cryptographic signature', async () => {
    const challenge = await createSiweChallenge(31337);

    const siweMessage = new SiweMessage({
      domain: 'localhost:3000',
      address: testAccount.address,
      statement: 'Sign in to CertProof',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 31337,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    // Tampered signature
    const invalidSignature = '0x' + '1'.repeat(130);

    const result = await verifySiweChallenge({
      message: messageText,
      signature: invalidSignature,
      browserBindingToken: challenge.browserBindingToken,
      requestOrigin: 'http://localhost:3000',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toMatch(/SIGNATURE_FAILED|VERIFICATION_ERROR/);
  });

  it('rejects domain mismatch', async () => {
    const challenge = await createSiweChallenge(31337);

    const siweMessage = new SiweMessage({
      domain: 'phishing-site.com',
      address: testAccount.address,
      statement: 'Sign in to CertProof',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 31337,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message: messageText });

    const result = await verifySiweChallenge({
      message: messageText,
      signature,
      browserBindingToken: challenge.browserBindingToken,
      requestOrigin: 'http://localhost:3000',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('DOMAIN_MISMATCH');
  });

  it('rejects URI mismatch', async () => {
    const challenge = await createSiweChallenge(31337);

    const siweMessage = new SiweMessage({
      domain: 'localhost:3000',
      address: testAccount.address,
      statement: 'Sign in to CertProof',
      uri: 'http://evil.com/callback',
      version: '1',
      chainId: 31337,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message: messageText });

    const result = await verifySiweChallenge({
      message: messageText,
      signature,
      browserBindingToken: challenge.browserBindingToken,
      requestOrigin: 'http://localhost:3000',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('URI_MISMATCH');
  });

  it('rejects chain ID mismatch', async () => {
    const challenge = await createSiweChallenge(31337);

    const siweMessage = new SiweMessage({
      domain: 'localhost:3000',
      address: testAccount.address,
      statement: 'Sign in to CertProof',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 1, // Mainnet instead of configured 31337
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message: messageText });

    const result = await verifySiweChallenge({
      message: messageText,
      signature,
      browserBindingToken: challenge.browserBindingToken,
      requestOrigin: 'http://localhost:3000',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CHAIN_MISMATCH');
  });

  it('rejects cross-browser challenge usage (mismatched binding token)', async () => {
    const challenge = await createSiweChallenge(31337);

    const siweMessage = new SiweMessage({
      domain: 'localhost:3000',
      address: testAccount.address,
      statement: 'Sign in to CertProof',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 31337,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message: messageText });

    // Different browser binding token
    const foreignBindingToken = 'a'.repeat(64);

    const result = await verifySiweChallenge({
      message: messageText,
      signature,
      browserBindingToken: foreignBindingToken,
      requestOrigin: 'http://localhost:3000',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('INVALID_CHALLENGE');
  });

  it('rejects replayed nonce (atomic once-only redemption)', async () => {
    const challenge = await createSiweChallenge(31337);

    const siweMessage = new SiweMessage({
      domain: 'localhost:3000',
      address: testAccount.address,
      statement: 'Sign in to CertProof',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 31337,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message: messageText });

    // First redemption succeeds
    const firstAttempt = await verifySiweChallenge({
      message: messageText,
      signature,
      browserBindingToken: challenge.browserBindingToken,
      requestOrigin: 'http://localhost:3000',
    });
    expect(firstAttempt.success).toBe(true);

    // Second redemption fails
    const secondAttempt = await verifySiweChallenge({
      message: messageText,
      signature,
      browserBindingToken: challenge.browserBindingToken,
      requestOrigin: 'http://localhost:3000',
    });
    expect(secondAttempt.success).toBe(false);
    expect(secondAttempt.errorCode).toBe('INVALID_CHALLENGE');
  });

  it('rejects CSRF origin mismatch', async () => {
    const challenge = await createSiweChallenge(31337);

    const siweMessage = new SiweMessage({
      domain: 'localhost:3000',
      address: testAccount.address,
      statement: 'Sign in to CertProof',
      uri: 'http://localhost:3000',
      version: '1',
      chainId: 31337,
      nonce: challenge.nonce,
      issuedAt: new Date().toISOString(),
    });

    const messageText = siweMessage.prepareMessage();
    const signature = await testAccount.signMessage({ message: messageText });

    const result = await verifySiweChallenge({
      message: messageText,
      signature,
      browserBindingToken: challenge.browserBindingToken,
      requestOrigin: 'http://attacker-origin.com',
    });

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CSRF_REJECTED');
  });
});
