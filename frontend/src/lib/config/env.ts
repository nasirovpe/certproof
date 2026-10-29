/**
 * Environment configuration and strict validation.
 * Ensures secrets remain strictly server-side, validates deployment identity,
 * and distinguishes container-internal RPCs from browser-reachable endpoints.
 */

export interface ServerEnv {
  MONGODB_URI: string;
  SESSION_SECRET: string;
  NODE_ENV: 'development' | 'production' | 'test';
  APP_ENV: 'local' | 'development' | 'test' | 'staging' | 'production';
  IS_LOCAL_DEV: boolean;
  TRUST_PROXY: boolean;
  SERVER_RPC_URL?: string;
  COOKIE_SECURE: boolean;
}

export interface ClientEnv {
  NEXT_PUBLIC_APP_URL: string;
  NEXT_PUBLIC_CHAIN_ID: number;
  NEXT_PUBLIC_REGISTRY_ADDRESS: `0x${string}`;
  NEXT_PUBLIC_ANVIL_RPC_URL: string;
  NEXT_PUBLIC_SEPOLIA_RPC_URL?: string;
  appOrigin: string;
  siweDomain: string;
  siweUri: string;
}

const ETH_ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;

export function validateOrigin(urlStr: string): { origin: string; host: string } {
  try {
    const parsed = new URL(urlStr);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Invalid protocol '${parsed.protocol}'. Expected 'http:' or 'https:'.`);
    }
    return {
      origin: parsed.origin,
      host: parsed.host,
    };
  } catch (err) {
    throw new Error(`Invalid application URL '${urlStr}': ${err instanceof Error ? err.message : 'Malformed URL'}`);
  }
}

const KNOWN_DEV_SECRETS = new Set([
  'dev_secret_must_be_overridden_in_production_32chars',
  'dev_session_secret_change_me_to_at_least_32_characters_long',
  'certproof_local_production_session_secret_32bytes_long',
  'c8d4e9f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9',
  'certproof_smoke_test_session_secret_32bytes!',
  'certproof_screenshot_session_secret_32bytes_long!',
  'replace_with_cryptographically_secure_random_secret_min_32_bytes',
  'your-secret-at-least-32-chars-long',
]);

const KNOWN_DEV_MONGO_PATTERNS = [
  'certproof_local_pass',
  'certproof_dev_password',
  'replace_with_',
  'password123',
  'changeme',
];

export function isDisallowedDevSecret(secret: string): boolean {
  const normalized = secret.toLowerCase().trim();
  if (KNOWN_DEV_SECRETS.has(normalized)) return true;
  if (/change[-_]?me|replace[-_]?with|placeholder|dummy|sample[-_]?secret/i.test(normalized)) {
    return true;
  }
  return false;
}

export function isDisallowedDevMongoUri(uri: string): boolean {
  const normalized = uri.toLowerCase();
  return KNOWN_DEV_MONGO_PATTERNS.some(pat => normalized.includes(pat));
}

export function getServerEnv(): ServerEnv {
  const NODE_ENV = (process.env.NODE_ENV || 'development') as 'development' | 'production' | 'test';
  const rawAppEnv = (process.env.APP_ENV || process.env.CERTPROOF_ENV || '').toLowerCase().trim();

  // Determine explicit deployment environment
  let APP_ENV: 'local' | 'development' | 'test' | 'staging' | 'production';
  let IS_LOCAL_DEV: boolean;

  if (rawAppEnv === 'local' || rawAppEnv === 'development' || rawAppEnv === 'test') {
    APP_ENV = rawAppEnv as 'local' | 'development' | 'test';
    IS_LOCAL_DEV = true;
  } else if (rawAppEnv === 'staging' || rawAppEnv === 'production') {
    APP_ENV = rawAppEnv as 'staging' | 'production';
    IS_LOCAL_DEV = false;
  } else if (!rawAppEnv) {
    if (NODE_ENV === 'production') {
      APP_ENV = 'production';
      IS_LOCAL_DEV = false;
    } else if (NODE_ENV === 'test') {
      APP_ENV = 'test';
      IS_LOCAL_DEV = true;
    } else {
      APP_ENV = 'development';
      IS_LOCAL_DEV = true;
    }
  } else {
    throw new Error(`FATAL: Invalid APP_ENV '${rawAppEnv}'. Expected 'local', 'development', 'test', 'staging', or 'production'.`);
  }

  // Local development convenience defaults
  let MONGODB_URI = process.env.MONGODB_URI;
  let SESSION_SECRET = process.env.SESSION_SECRET;

  if (IS_LOCAL_DEV) {
    if (!MONGODB_URI) {
      MONGODB_URI = 'mongodb://127.0.0.1:27018/certproof';
    }
    if (!SESSION_SECRET) {
      SESSION_SECRET = 'dev_secret_must_be_overridden_in_production_32chars';
    }
  }

  // Non-local / Staging / Production strict validation
  if (!IS_LOCAL_DEV) {
    if (!SESSION_SECRET || SESSION_SECRET.trim() === '') {
      throw new Error(`FATAL: In non-local environment (${APP_ENV}), SESSION_SECRET must be configured.`);
    }
    if (SESSION_SECRET.length < 32) {
      throw new Error(`FATAL: In non-local environment (${APP_ENV}), SESSION_SECRET must be at least 32 characters long.`);
    }
    if (isDisallowedDevSecret(SESSION_SECRET)) {
      throw new Error(`FATAL: In non-local environment (${APP_ENV}), SESSION_SECRET cannot use default or placeholder credentials. Generate a strong, random secret.`);
    }

    if (!MONGODB_URI || MONGODB_URI.trim() === '') {
      throw new Error(`FATAL: In non-local environment (${APP_ENV}), MONGODB_URI must be configured.`);
    }
    if (isDisallowedDevMongoUri(MONGODB_URI)) {
      throw new Error(`FATAL: In non-local environment (${APP_ENV}), MONGODB_URI cannot use known development credentials or placeholders. Provide dedicated database credentials.`);
    }

    try {
      const parsedMongo = new URL(MONGODB_URI);
      if (!parsedMongo.username || !parsedMongo.password) {
        throw new Error(`FATAL: In non-local environment (${APP_ENV}), MONGODB_URI must specify authenticated credentials (username and password).`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('FATAL:')) throw e;
      throw new Error(`FATAL: In non-local environment (${APP_ENV}), MONGODB_URI is malformed.`);
    }
  }

  const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';
  const SERVER_RPC_URL = process.env.SERVER_RPC_URL;

  // Cookie secure flag: default true in non-local production/staging unless explicitly overridden
  const COOKIE_SECURE = process.env.COOKIE_SECURE !== undefined
    ? process.env.COOKIE_SECURE === 'true' || process.env.COOKIE_SECURE === '1'
    : (NODE_ENV === 'production' && !IS_LOCAL_DEV);

  return {
    MONGODB_URI: MONGODB_URI!,
    SESSION_SECRET: SESSION_SECRET!,
    NODE_ENV,
    APP_ENV,
    IS_LOCAL_DEV,
    TRUST_PROXY,
    SERVER_RPC_URL,
    COOKIE_SECURE,
  };
}

export function getClientEnv(): ClientEnv {
  const rawUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const { origin: appOrigin, host: siweDomain } = validateOrigin(rawUrl);

  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 31337);
  if (chainId !== 31337 && chainId !== 11155111) {
    console.warn(`[WARN] Unsupported NEXT_PUBLIC_CHAIN_ID: ${chainId}. Expected 31337 (Anvil) or 11155111 (Sepolia).`);
  }

  const rawRegistry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS || '0x5fbdb2315678afecb367f032d93f642f64180aa3';
  if (!ETH_ADDRESS_REGEX.test(rawRegistry)) {
    throw new Error(`FATAL: Invalid NEXT_PUBLIC_REGISTRY_ADDRESS '${rawRegistry}'. Must be a 42-character hex address.`);
  }
  const registryAddress = rawRegistry.toLowerCase() as `0x${string}`;

  const anvilRpc = process.env.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545';
  const sepoliaRpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL;

  if (chainId === 11155111 && !sepoliaRpc) {
    console.warn('[WARN] Sepolia chain selected (11155111) but NEXT_PUBLIC_SEPOLIA_RPC_URL is not configured.');
  }

  return {
    NEXT_PUBLIC_APP_URL: appOrigin,
    NEXT_PUBLIC_CHAIN_ID: chainId,
    NEXT_PUBLIC_REGISTRY_ADDRESS: registryAddress,
    NEXT_PUBLIC_ANVIL_RPC_URL: anvilRpc,
    NEXT_PUBLIC_SEPOLIA_RPC_URL: sepoliaRpc,
    appOrigin,
    siweDomain,
    siweUri: appOrigin,
  };
}
