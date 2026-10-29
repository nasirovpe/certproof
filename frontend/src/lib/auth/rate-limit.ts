/**
 * Process-Local In-Memory Rate Limiter.
 *
 * Scope & Limitations:
 * - Process-Local: State is maintained strictly within this Node.js process memory.
 * - Single-Instance Only: If the application is scaled horizontally (multiple containers
 *   or cluster worker threads), rate limits are not shared across instances.
 *   For multi-instance distributed rate limiting, an external shared store (e.g. Redis)
 *   or an edge reverse proxy (e.g. Nginx limit_req or Cloudflare WAF) must be used.
 * - Bounded Capacity: Enforces a maximum tracking capacity (MAX_TRACKED_IPS = 5000)
 *   with oldest-entry eviction to prevent memory exhaustion under spoofed requests.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

const MAX_TRACKED_IPS = 5000;
const ipStore = new Map<string, RateLimitRecord>();

let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 60_000;

export function resetRateLimitStore(): void {
  ipStore.clear();
  lastCleanup = Date.now();
}

function cleanupExpired() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  ipStore.forEach((record, ip) => {
    if (now >= record.resetAt) {
      ipStore.delete(ip);
    }
  });
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  identifier: string,
  maxRequests: number = 30,
  windowMs: number = 60_000
): RateLimitResult {
  cleanupExpired();

  const now = Date.now();
  const existing = ipStore.get(identifier);

  if (!existing || now >= existing.resetAt) {
    if (ipStore.size >= MAX_TRACKED_IPS) {
      // Evict oldest or clear expired immediately
      const firstKey = ipStore.keys().next().value;
      if (firstKey) ipStore.delete(firstKey);
    }

    const resetAt = now + windowMs;
    ipStore.set(identifier, { count: 1, resetAt });
    return { success: true, limit: maxRequests, remaining: maxRequests - 1, resetAt };
  }

  if (existing.count >= maxRequests) {
    return { success: false, limit: maxRequests, remaining: 0, resetAt: existing.resetAt };
  }

  existing.count += 1;
  return {
    success: true,
    limit: maxRequests,
    remaining: maxRequests - existing.count,
    resetAt: existing.resetAt,
  };
}
