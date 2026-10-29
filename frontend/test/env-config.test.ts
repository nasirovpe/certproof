import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getServerEnv, isDisallowedDevSecret, isDisallowedDevMongoUri } from '../src/lib/config/env';

const setNodeEnv = (val: string) => {
  (process.env as Record<string, string | undefined>).NODE_ENV = val;
};

describe('Server Environment Configuration & Credential Isolation', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset env before each test
    process.env = { ...originalEnv };
    delete process.env.APP_ENV;
    delete process.env.CERTPROOF_ENV;
    delete process.env.SESSION_SECRET;
    delete process.env.MONGODB_URI;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Local Development Mode', () => {
    it('provides local convenience defaults when APP_ENV=local', () => {
      process.env.APP_ENV = 'local';
      setNodeEnv('development');

      const env = getServerEnv();
      expect(env.APP_ENV).toBe('local');
      expect(env.IS_LOCAL_DEV).toBe(true);
      expect(env.MONGODB_URI).toBe('mongodb://127.0.0.1:27018/certproof');
      expect(env.SESSION_SECRET).toBe('dev_secret_must_be_overridden_in_production_32chars');
      expect(env.COOKIE_SECURE).toBe(false);
    });

    it('permits local Docker container runs with NODE_ENV=production when APP_ENV=local', () => {
      process.env.APP_ENV = 'local';
      setNodeEnv('production');
      process.env.SESSION_SECRET = 'certproof_local_production_session_secret_32bytes_long';
      process.env.MONGODB_URI = 'mongodb://certproof_admin:certproof_local_pass@127.0.0.1:27017/certproof?authSource=admin';

      const env = getServerEnv();
      expect(env.IS_LOCAL_DEV).toBe(true);
      expect(env.NODE_ENV).toBe('production');
      expect(env.APP_ENV).toBe('local');
    });
  });

  describe('Non-Local / Staging / Production Enforcement', () => {
    it('infers non-local production when NODE_ENV=production and APP_ENV is unset', () => {
      setNodeEnv('production');
      delete process.env.APP_ENV;

      expect(() => getServerEnv()).toThrow(/In non-local environment \(production\)/);
    });

    it('rejects missing SESSION_SECRET in staging', () => {
      process.env.APP_ENV = 'staging';
      process.env.MONGODB_URI = 'mongodb://prod_user:SuperStrongSecretPass123!@mongo.internal:27017/certproof?authSource=admin';
      delete process.env.SESSION_SECRET;

      expect(() => getServerEnv()).toThrow(/SESSION_SECRET must be configured/);
    });

    it('rejects short SESSION_SECRET (< 32 chars) in production', () => {
      process.env.APP_ENV = 'production';
      process.env.SESSION_SECRET = 'short_secret_under_32_chars';
      process.env.MONGODB_URI = 'mongodb://prod_user:SuperStrongSecretPass123!@mongo.internal:27017/certproof?authSource=admin';

      expect(() => getServerEnv()).toThrow(/must be at least 32 characters long/);
    });

    it('rejects known development SESSION_SECRET in non-local environment', () => {
      process.env.APP_ENV = 'production';
      process.env.SESSION_SECRET = 'certproof_local_production_session_secret_32bytes_long';
      process.env.MONGODB_URI = 'mongodb://prod_user:SuperStrongSecretPass123!@mongo.internal:27017/certproof?authSource=admin';

      expect(() => getServerEnv()).toThrow(/cannot use default or placeholder credentials/);
    });

    it('rejects placeholder patterns in SESSION_SECRET', () => {
      process.env.APP_ENV = 'staging';
      process.env.SESSION_SECRET = 'replace_with_my_own_super_secret_key_12345';
      process.env.MONGODB_URI = 'mongodb://prod_user:SuperStrongSecretPass123!@mongo.internal:27017/certproof?authSource=admin';

      expect(() => getServerEnv()).toThrow(/cannot use default or placeholder credentials/);
    });

    it('rejects missing MONGODB_URI in non-local environment', () => {
      process.env.APP_ENV = 'production';
      process.env.SESSION_SECRET = 'a_very_strong_production_session_secret_that_is_long!';
      delete process.env.MONGODB_URI;

      expect(() => getServerEnv()).toThrow(/MONGODB_URI must be configured/);
    });

    it('rejects known development credentials in MONGODB_URI', () => {
      process.env.APP_ENV = 'production';
      process.env.SESSION_SECRET = 'a_very_strong_production_session_secret_that_is_long!';
      process.env.MONGODB_URI = 'mongodb://certproof_admin:certproof_local_pass@mongo:27017/certproof?authSource=admin';

      expect(() => getServerEnv()).toThrow(/cannot use known development credentials/);
    });

    it('rejects unauthenticated MONGODB_URI in non-local environment', () => {
      process.env.APP_ENV = 'production';
      process.env.SESSION_SECRET = 'a_very_strong_production_session_secret_that_is_long!';
      process.env.MONGODB_URI = 'mongodb://mongo.internal:27017/certproof';

      expect(() => getServerEnv()).toThrow(/must specify authenticated credentials/);
    });

    it('accepts valid, strong non-local configuration', () => {
      setNodeEnv('production');
      process.env.APP_ENV = 'production';
      process.env.SESSION_SECRET = 'e9f4c2a1b7d8e0f3a5c6b8d9e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0';
      process.env.MONGODB_URI = 'mongodb://certproof_prod_user:VaultPass9876543210!@mongo.internal:27017/certproof?authSource=admin&tls=true';

      const env = getServerEnv();
      expect(env.APP_ENV).toBe('production');
      expect(env.IS_LOCAL_DEV).toBe(false);
      expect(env.COOKIE_SECURE).toBe(true);
    });

    it('never prints secret or password values in error messages', () => {
      const secretAttempt = 'change_me_to_something_secret_that_should_never_leak!';
      process.env.APP_ENV = 'production';
      process.env.SESSION_SECRET = secretAttempt;
      process.env.MONGODB_URI = 'mongodb://certproof_admin:certproof_local_pass@mongo:27017/certproof?authSource=admin';

      try {
        getServerEnv();
        expect.unreachable('Should have thrown an error');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        expect(message).not.toContain(secretAttempt);
        expect(message).not.toContain('certproof_local_pass');
      }
    });
  });

  describe('Disallowed Credentials Checker Functions', () => {
    it('flags known dev secrets and placeholder strings', () => {
      expect(isDisallowedDevSecret('dev_secret_must_be_overridden_in_production_32chars')).toBe(true);
      expect(isDisallowedDevSecret('certproof_local_production_session_secret_32bytes_long')).toBe(true);
      expect(isDisallowedDevSecret('THIS_HAS_CHANGE_ME_IN_IT_AND_IS_LONG')).toBe(true);
      expect(isDisallowedDevSecret('replace-with-something-secure-for-prod')).toBe(true);
      expect(isDisallowedDevSecret('totally-random-secret-generated-by-openssl-rand-hex-32')).toBe(false);
    });

    it('flags known dev passwords in database URIs', () => {
      expect(isDisallowedDevMongoUri('mongodb://user:certproof_local_pass@localhost:27017/db')).toBe(true);
      expect(isDisallowedDevMongoUri('mongodb://user:certproof_dev_password@localhost:27017/db')).toBe(true);
      expect(isDisallowedDevMongoUri('mongodb://user:REPLACE_WITH_PASSWORD@localhost:27017/db')).toBe(true);
      expect(isDisallowedDevMongoUri('mongodb://realuser:RealHighEntropySecret987!@db.internal:27017/db')).toBe(false);
    });
  });
});
