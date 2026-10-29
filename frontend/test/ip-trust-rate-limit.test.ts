import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveClientIp, isValidIp } from '@/lib/auth/ip';
import { checkRateLimit, resetRateLimitStore } from '@/lib/auth/rate-limit';

describe('IP Resolution & Reverse Proxy Trust Policy', () => {
  const originalEnv = process.env.TRUST_PROXY;

  beforeEach(() => {
    resetRateLimitStore();
    delete process.env.TRUST_PROXY;
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.TRUST_PROXY = originalEnv;
    } else {
      delete process.env.TRUST_PROXY;
    }
  });

  describe('Syntax Validation', () => {
    it('validates standard IPv4 addresses', () => {
      expect(isValidIp('127.0.0.1')).toBe(true);
      expect(isValidIp('192.168.1.1')).toBe(true);
      expect(isValidIp('203.0.113.195')).toBe(true);
      expect(isValidIp('999.999.999.999')).toBe(false);
      expect(isValidIp('not-an-ip')).toBe(false);
    });

    it('validates standard IPv6 addresses', () => {
      expect(isValidIp('::1')).toBe(true);
      expect(isValidIp('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
      expect(isValidIp('fe80::1')).toBe(true);
      expect(isValidIp(':::')).toBe(false);
    });
  });

  describe('Default Untrusted Proxy Mode (TRUST_PROXY unset or false)', () => {
    it('ignores client-supplied X-Forwarded-For and X-Real-IP headers by default', () => {
      process.env.TRUST_PROXY = 'false';

      const headers = new Headers({
        'x-forwarded-for': '203.0.113.10',
        'x-real-ip': '203.0.113.20',
      });

      const resolved = resolveClientIp(headers);
      expect(resolved).toBe('untrusted-client');
    });

    it('prevents rate-limit bypass via forged X-Forwarded-For rotation', () => {
      process.env.TRUST_PROXY = 'false';
      const maxLimit = 5;

      // An attacker attempts 10 requests with a different forged IP each time
      const results: boolean[] = [];
      for (let i = 0; i < 10; i++) {
        const forgedHeaders = new Headers({
          'x-forwarded-for': `198.51.100.${i + 1}`,
        });

        const clientIp = resolveClientIp(forgedHeaders);
        const rateLimitResult = checkRateLimit(`auth:${clientIp}`, maxLimit, 60_000);
        results.push(rateLimitResult.success);
      }

      // First 5 requests should pass (capacity = 5)
      expect(results.slice(0, 5)).toEqual([true, true, true, true, true]);
      // Subsequent requests MUST be blocked even though X-Forwarded-For changed every time
      expect(results.slice(5)).toEqual([false, false, false, false, false]);
    });
  });

  describe('Trusted Proxy Mode (TRUST_PROXY=true)', () => {
    beforeEach(() => {
      process.env.TRUST_PROXY = 'true';
    });

    it('extracts trusted X-Real-IP when provided by perimeter proxy', () => {
      const headers = new Headers({
        'x-real-ip': '198.51.100.55',
        'x-forwarded-for': '198.51.100.55, 10.0.0.1',
      });

      const resolved = resolveClientIp(headers);
      expect(resolved).toBe('198.51.100.55');
    });

    it('extracts first client IP from X-Forwarded-For if X-Real-IP is absent', () => {
      const headers = new Headers({
        'x-forwarded-for': '203.0.113.42, 10.0.0.2',
      });

      const resolved = resolveClientIp(headers);
      expect(resolved).toBe('203.0.113.42');
    });

    it('falls back safely to proxy-fallback when forwarded IP is malformed or forged injection', () => {
      const headers = new Headers({
        'x-forwarded-for': '<script>alert(1)</script>, 10.0.0.1',
      });

      const resolved = resolveClientIp(headers);
      expect(resolved).toBe('proxy-fallback');
    });

    it('tracks distinct legitimate client IPs in separate rate limit buckets', () => {
      const maxLimit = 2;

      // Client A
      const headersA = new Headers({ 'x-real-ip': '198.51.100.1' });
      const ipA = resolveClientIp(headersA);
      expect(checkRateLimit(`test:${ipA}`, maxLimit).success).toBe(true);
      expect(checkRateLimit(`test:${ipA}`, maxLimit).success).toBe(true);
      expect(checkRateLimit(`test:${ipA}`, maxLimit).success).toBe(false); // blocked

      // Client B (different IP) should NOT be blocked by Client A's exhaustion
      const headersB = new Headers({ 'x-real-ip': '198.51.100.2' });
      const ipB = resolveClientIp(headersB);
      expect(checkRateLimit(`test:${ipB}`, maxLimit).success).toBe(true);
      expect(checkRateLimit(`test:${ipB}`, maxLimit).success).toBe(true);
      expect(checkRateLimit(`test:${ipB}`, maxLimit).success).toBe(false); // now blocked
    });
  });
});
