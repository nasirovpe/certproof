// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import {
  buildCanonicalVerificationUrl,
  parseCanonicalVerificationUrl,
  validateApplicationOrigin,
  isLocalOrigin,
  getSafeQrFilename,
  generateVerificationQrPngBuffer,
  generateVerificationQrDataUrl,
  triggerQrDownload,
  SUPPORTED_CHAIN_IDS,
  QR_CODE_WIDTH,
  QR_LOOKUP_EXPLANATION,
  LOCALHOST_ORIGIN_NOTICE,
} from '@/lib/certificate/share';

const VALID_CERT_ID = '0x1111111111111111111111111111111111111111111111111111111111111111';
const VALID_CHAIN_ID = 31337;
const VALID_REGISTRY = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
const VALID_ORIGIN = 'http://localhost:3000';

describe('Canonical Verification Links & URL Builder Suite', () => {
  it('1. Constructs standard canonical URL scoped to certId, chainId, registry', () => {
    const url = buildCanonicalVerificationUrl({
      certId: VALID_CERT_ID,
      chainId: VALID_CHAIN_ID,
      registryAddress: VALID_REGISTRY,
      origin: VALID_ORIGIN,
    });

    expect(url).toBe(
      'http://localhost:3000/verify/0x1111111111111111111111111111111111111111111111111111111111111111?chainId=31337&registry=0x5FbDB2315678afecb367f032d93F642f64180aa3'
    );
  });

  it('2. Preserves strict information hygiene: contains NO filenames, PDF bytes, signatures, or tokens', () => {
    const url = buildCanonicalVerificationUrl({
      certId: VALID_CERT_ID,
      chainId: VALID_CHAIN_ID,
      registryAddress: VALID_REGISTRY,
      origin: VALID_ORIGIN,
    });

    const parsed = new URL(url);
    const searchKeys = Array.from(parsed.searchParams.keys());
    expect(searchKeys.sort()).toEqual(['chainId', 'registry'].sort());

    // Assert no personal data or file information in search or hash
    expect(parsed.hash).toBe('');
    expect(url).not.toMatch(/pdf/i);
    expect(url).not.toMatch(/token/i);
    expect(url).not.toMatch(/sign/i);
    expect(url).not.toMatch(/session/i);
  });

  it('3. Rejects malformed certificate IDs (short, non-hex, all-zero)', () => {
    // Too short
    expect(() =>
      buildCanonicalVerificationUrl({
        certId: '0x123',
        chainId: VALID_CHAIN_ID,
        registryAddress: VALID_REGISTRY,
        origin: VALID_ORIGIN,
      })
    ).toThrow(/MALFORMED_ID/);

    // All zeroes
    expect(() =>
      buildCanonicalVerificationUrl({
        certId: '0x0000000000000000000000000000000000000000000000000000000000000000',
        chainId: VALID_CHAIN_ID,
        registryAddress: VALID_REGISTRY,
        origin: VALID_ORIGIN,
      })
    ).toThrow(/MALFORMED_ID/);

    // Non-hex characters
    expect(() =>
      buildCanonicalVerificationUrl({
        certId: '0xzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz',
        chainId: VALID_CHAIN_ID,
        registryAddress: VALID_REGISTRY,
        origin: VALID_ORIGIN,
      })
    ).toThrow(/MALFORMED_ID/);
  });

  it('4. Rejects unsupported or invalid chain IDs', () => {
    // Non-integer or negative
    expect(() =>
      buildCanonicalVerificationUrl({
        certId: VALID_CERT_ID,
        chainId: -1,
        registryAddress: VALID_REGISTRY,
        origin: VALID_ORIGIN,
      })
    ).toThrow(/INVALID_CHAIN_ID/);

    // Unsupported chain (e.g. Ethereum Mainnet 1, which is not configured for MVP)
    expect(() =>
      buildCanonicalVerificationUrl({
        certId: VALID_CERT_ID,
        chainId: 1,
        registryAddress: VALID_REGISTRY,
        origin: VALID_ORIGIN,
      })
    ).toThrow(/UNSUPPORTED_CHAIN/);
  });

  it('5. Rejects invalid registry addresses', () => {
    expect(() =>
      buildCanonicalVerificationUrl({
        certId: VALID_CERT_ID,
        chainId: VALID_CHAIN_ID,
        registryAddress: 'not-an-address',
        origin: VALID_ORIGIN,
      })
    ).toThrow(/INVALID_REGISTRY_ADDRESS/);
  });

  it('6. Strict origin validation: rejects dangerous protocols, credentials, and non-URLs', () => {
    expect(() => validateApplicationOrigin('javascript:alert(1)')).toThrow(/INVALID_ORIGIN_PROTOCOL/i);
    expect(() => validateApplicationOrigin('file:///etc/passwd')).toThrow(/INVALID_ORIGIN_PROTOCOL/i);
    expect(() => validateApplicationOrigin('https://user:pass@evil.com')).toThrow(/INVALID_ORIGIN_CREDENTIALS/i);
    expect(() => validateApplicationOrigin('')).toThrow(/INVALID_ORIGIN/);
    expect(() => validateApplicationOrigin('not a url ://')).toThrow(/INVALID_ORIGIN/);

    // Valid origins normalize cleanly
    expect(validateApplicationOrigin('https://certproof.example.com/')).toBe(
      'https://certproof.example.com'
    );
    expect(validateApplicationOrigin('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('7. Accurately flags local development origins for user transparency', () => {
    expect(isLocalOrigin('http://localhost:3000')).toBe(true);
    expect(isLocalOrigin('http://127.0.0.1:8545')).toBe(true);
    expect(isLocalOrigin('http://[::1]:3000')).toBe(true);
    expect(isLocalOrigin('http://my-mac.local:3000')).toBe(true);
    expect(isLocalOrigin('https://certproof.example.com')).toBe(false);
    expect(isLocalOrigin('https://sepolia.certproof.org')).toBe(false);
  });

  it('8. Round-trip: parsing canonical verification URL succeeds and preserves all parameters', () => {
    const canonical = buildCanonicalVerificationUrl({
      certId: VALID_CERT_ID,
      chainId: 11155111,
      registryAddress: VALID_REGISTRY,
      origin: 'https://certproof.example.com',
    });

    const parsed = parseCanonicalVerificationUrl(canonical);
    expect(parsed.certId).toBe(VALID_CERT_ID.toLowerCase());
    expect(parsed.chainId).toBe(11155111);
    expect(parsed.registryAddress.toLowerCase()).toBe(VALID_REGISTRY.toLowerCase());
    expect(parsed.origin).toBe('https://certproof.example.com');
  });

  it('9. Parsing rejects URLs with missing or malformed components', () => {
    expect(() => parseCanonicalVerificationUrl('not-a-url')).toThrow(/MALFORMED_URL/);

    // Invalid path
    expect(() =>
      parseCanonicalVerificationUrl('http://localhost:3000/wrong-path?chainId=31337&registry=' + VALID_REGISTRY)
    ).toThrow(/MALFORMED_PATH/);

    // Missing chainId
    expect(() =>
      parseCanonicalVerificationUrl(`http://localhost:3000/verify/${VALID_CERT_ID}?registry=` + VALID_REGISTRY)
    ).toThrow(/MISSING_PARAMETER/);

    // Missing registry
    expect(() =>
      parseCanonicalVerificationUrl(`http://localhost:3000/verify/${VALID_CERT_ID}?chainId=31337`)
    ).toThrow(/MISSING_PARAMETER/);

    // Unsupported chain
    expect(() =>
      parseCanonicalVerificationUrl(
        `http://localhost:3000/verify/${VALID_CERT_ID}?chainId=999&registry=` + VALID_REGISTRY
      )
    ).toThrow(/UNSUPPORTED_CHAIN/);
  });
});

describe('QR Code Generation & Independent Decoding Verification Suite', () => {
  it('1. Generates QR image and decodes with independent decoder (jsQR) with exact equality', async () => {
    const canonicalUrl = buildCanonicalVerificationUrl({
      certId: VALID_CERT_ID,
      chainId: VALID_CHAIN_ID,
      registryAddress: VALID_REGISTRY,
      origin: VALID_ORIGIN,
    });

    // 1. Generate local QR code PNG buffer
    const pngBuffer = await generateVerificationQrPngBuffer(canonicalUrl, {
      width: QR_CODE_WIDTH,
      margin: 4,
    });

    expect(pngBuffer.length).toBeGreaterThan(0);

    // 2. Decode using independent PNG reader and independent jsQR
    const png = PNG.sync.read(pngBuffer);
    expect(png.width).toBe(QR_CODE_WIDTH);
    expect(png.height).toBe(QR_CODE_WIDTH);

    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded).toBeTruthy();
    expect(decoded?.data).toBe(canonicalUrl);

    // 3. Verify that chain ID, registry address, and certificate ID survive encoding and decoding
    const parsedFromDecoded = parseCanonicalVerificationUrl(decoded!.data);
    expect(parsedFromDecoded.certId).toBe(VALID_CERT_ID.toLowerCase());
    expect(parsedFromDecoded.chainId).toBe(VALID_CHAIN_ID);
    expect(parsedFromDecoded.registryAddress.toLowerCase()).toBe(VALID_REGISTRY.toLowerCase());
  });

  it('2. Generates QR codes for revoked certificates and deauthorized issuers without discrimination', async () => {
    const revokedCertId = '0x2222222222222222222222222222222222222222222222222222222222222222';
    const canonicalRevokedUrl = buildCanonicalVerificationUrl({
      certId: revokedCertId,
      chainId: VALID_CHAIN_ID,
      registryAddress: VALID_REGISTRY,
      origin: VALID_ORIGIN,
    });

    const pngBuffer = await generateVerificationQrPngBuffer(canonicalRevokedUrl);
    const png = PNG.sync.read(pngBuffer);
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);

    expect(decoded?.data).toBe(canonicalRevokedUrl);
    expect(decoded?.data).toContain(revokedCertId.toLowerCase());
  });

  it('3. Generates browser Data URL correctly', async () => {
    const canonicalUrl = buildCanonicalVerificationUrl({
      certId: VALID_CERT_ID,
      chainId: VALID_CHAIN_ID,
      registryAddress: VALID_REGISTRY,
      origin: VALID_ORIGIN,
    });

    const dataUrl = await generateVerificationQrDataUrl(canonicalUrl, { width: 256 });
    expect(dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('4. Generates safe filenames based strictly on certificate ID', () => {
    const safeName1 = getSafeQrFilename(VALID_CERT_ID);
    expect(safeName1).toBe('certproof-qr-0x1111111111111111.png');
    expect(safeName1).toMatch(/^certproof-qr-[a-f0-9x]+\.png$/);

    // Handles uppercase and non-alphanumeric cleanly
    const safeName2 = getSafeQrFilename('0xABCDEF123456');
    expect(safeName2).toBe('certproof-qr-0xabcdef123456.png');
  });

  it('5. triggerQrDownload creates and cleans up DOM elements without leaking', () => {
    const appendSpy = vi.spyOn(document.body, 'appendChild');
    const removeSpy = vi.spyOn(document.body, 'removeChild');

    triggerQrDownload('data:image/png;base64,mock', 'test-qr.png');

    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);

    const appendedAnchor = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(appendedAnchor.download).toBe('test-qr.png');
    expect(appendedAnchor.href).toBe('data:image/png;base64,mock');
  });
});
