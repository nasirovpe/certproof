/**
 * Idempotent MongoDB index initialization script for CertProof.
 * Executed on initial database creation or safely re-run at any time.
 */

// In mongosh/docker-entrypoint, db points directly to MONGO_INITDB_DATABASE
print('[CertProof Init] Initializing collection indexes for database: ' + db.getName());

try { db.createCollection('siwe_challenges'); } catch (e) {}
try { db.createCollection('sessions'); } catch (e) {}

// Challenges collection indexes
db.siwe_challenges.createIndex({ nonce: 1 }, { unique: true, name: 'uniq_nonce' });
db.siwe_challenges.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });

// Sessions collection indexes
db.sessions.createIndex({ sessionTokenHash: 1 }, { unique: true, name: 'uniq_sessionTokenHash' });
db.sessions.createIndex({ walletAddress: 1 }, { name: 'idx_walletAddress' });
db.sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });

print('[CertProof Init] All indexes verified/created successfully.');
