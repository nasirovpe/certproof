import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import VerifyCertificatePage, { generateMetadata } from '@/app/verify/[certId]/page';

// Mock the inner PublicCertificateVerifier to verify received props
vi.mock('@/components/certificate/PublicCertificateVerifier', () => ({
  PublicCertificateVerifier: ({ certId, initialSearchParams }: { certId: string; initialSearchParams?: Record<string, string | undefined> }) => (
    <div data-testid="verifier-mock" data-cert-id={certId} data-search={JSON.stringify(initialSearchParams)} />
  ),
}));

describe('Next.js 15 Async Request & Page Parameters Regression Suite', () => {
  it('generateMetadata awaits asynchronous params Promise successfully', async () => {
    const mockParamsPromise = Promise.resolve({
      certId: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    });

    const metadata = await generateMetadata({
      params: mockParamsPromise,
    });

    expect(metadata.title).toBe('Verify Certificate 0x12345678... | CertProof');
    expect(metadata.description).toContain('Public zero-auth cryptographic certificate verification');
  });

  it('VerifyCertificatePage awaits asynchronous params and searchParams Promises', async () => {
    const mockParamsPromise = Promise.resolve({
      certId: '0x1111111111111111111111111111111111111111111111111111111111111111',
    });
    const mockSearchParamsPromise = Promise.resolve({
      chainId: '31337',
      registry: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
    });

    const pageElement = await VerifyCertificatePage({
      params: mockParamsPromise,
      searchParams: mockSearchParamsPromise,
    });

    expect(React.isValidElement(pageElement)).toBe(true);
    // Verify children contains the verifier component with resolved props
    const verifier = pageElement.props.children;
    expect(verifier.props.certId).toBe('0x1111111111111111111111111111111111111111111111111111111111111111');
    expect(verifier.props.initialSearchParams).toEqual({
      chainId: '31337',
      registry: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
    });
  });

  it('VerifyCertificatePage gracefully handles undefined searchParams Promise', async () => {
    const mockParamsPromise = Promise.resolve({
      certId: '0x2222222222222222222222222222222222222222222222222222222222222222',
    });

    const pageElement = await VerifyCertificatePage({
      params: mockParamsPromise,
    });

    expect(React.isValidElement(pageElement)).toBe(true);
    const verifier = pageElement.props.children;
    expect(verifier.props.certId).toBe('0x2222222222222222222222222222222222222222222222222222222222222222');
    expect(verifier.props.initialSearchParams).toEqual({});
  });
});
