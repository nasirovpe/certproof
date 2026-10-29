import { NextRequest } from 'next/server';
import { isIP } from 'node:net';

/**
 * IP syntax validation helper using Node.js built-in network address parser.
 * Returns true if the address is a valid IPv4 or IPv6 address.
 */
export function isValidIp(ip: string): boolean {
  if (!ip || typeof ip !== 'string') return false;
  return isIP(ip) !== 0;
}

/**
 * Safe client IP extraction.
 *
 * Security Model:
 * 1. Untrusted by default: If TRUST_PROXY is not enabled ('true' or '1'),
 *    forwarding headers (x-forwarded-for, x-real-ip) are strictly ignored.
 *    Arbitrary client-provided headers CANNOT generate new rate-limit identities
 *    or bypass rate limits.
 * 2. Trusted Proxy Mode: When TRUST_PROXY is explicitly enabled, the perimeter
 *    reverse proxy (e.g., Nginx, Caddy, Cloudflare) must strip incoming headers
 *    from clients and replace them with verified remote addresses.
 * 3. Safe Fallback: If no valid IP can be safely extracted, returns a static fallback
 *    ('untrusted-client' or 'proxy-fallback') to avoid memory exhaustion from
 *    random header injection.
 */
export function resolveClientIp(request: NextRequest | Headers): string {
  const isProxyTrusted = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

  if (!isProxyTrusted) {
    // Untrusted mode: ignore client-supplied forwarding headers completely.
    return 'untrusted-client';
  }

  const headers = 'headers' in request ? request.headers : request;

  // In trusted mode, check X-Real-IP first (commonly populated by reverse proxy from $remote_addr)
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp && isValidIp(realIp)) {
    return realIp;
  }

  // Next, check X-Forwarded-For
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const candidate = forwardedFor.split(',')[0].trim();
    if (candidate && isValidIp(candidate)) {
      return candidate;
    }
  }

  return 'proxy-fallback';
}
