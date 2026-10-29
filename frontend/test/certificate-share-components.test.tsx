// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import IssuerCertificateList from '@/components/certificate/IssuerCertificateList';
import { PublicCertificateVerifier } from '@/components/certificate/PublicCertificateVerifier';
import { CertificateShareModal } from '@/components/certificate/CertificateShareModal';
import * as registryLib from '@/lib/certificate/registry';
const VALID_CERT_ID = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
const REVOKED_CERT_ID = '0x2222222222222222222222222222222222222222222222222222222222222222' as const;
const ISSUER_ADDRESS = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266' as const;
const REGISTRY_ADDRESS = '0x5fbdb2315678afecb367f032d93f642f64180aa3' as const;

let mockAccount = {
  address: ISSUER_ADDRESS,
  isConnected: true,
};

let mockChainId = 31337;

vi.mock('wagmi', () => ({
  useAccount: () => mockAccount,
  useChainId: () => mockChainId,
  usePublicClient: () => null,
}));

describe('Certificate Share & QR Controls UI Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. IssuerCertificateList renders Share & QR controls for active and revoked entries', async () => {
    mockAccount = {
      address: ISSUER_ADDRESS,
      isConnected: true,
    };
    mockChainId = 31337;

    vi.spyOn(registryLib, 'fetchIssuerCertificates').mockResolvedValue({
      total: 2,
      nextOffset: 2,
      items: [
        {
          certId: VALID_CERT_ID,
          documentHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
          issuer: ISSUER_ADDRESS,
          registeredAt: 1700000000,
          revokedAt: 0,
          revoked: false,
          isIssuerCurrentlyAuthorized: true,
        },
        {
          certId: REVOKED_CERT_ID,
          documentHash: '0x4444444444444444444444444444444444444444444444444444444444444444',
          issuer: ISSUER_ADDRESS,
          registeredAt: 1700000000,
          revokedAt: 1700001000,
          revoked: true,
          isIssuerCurrentlyAuthorized: false,
        },
      ],
    });

    render(<IssuerCertificateList />);

    await waitFor(() => {
      expect(screen.getByText('Share & QR')).toBeTruthy();
    });

    // Check that Share controls exist for both active AND revoked certs
    const shareButtons = screen.getAllByRole('button', { name: /open share and qr modal/i });
    expect(shareButtons.length).toBe(2);

    const copyButtons = screen.getAllByRole('button', { name: /copy verification link/i });
    expect(copyButtons.length).toBe(2);

    const downloadButtons = screen.getAllByRole('button', { name: /download qr code/i });
    expect(downloadButtons.length).toBe(2);

    const openLinks = screen.getAllByRole('link', { name: /open verification page/i });
    expect(openLinks.length).toBe(2);

    // Assert canonical URL parameters in link
    expect(openLinks[0].getAttribute('href')?.toLowerCase()).toContain(`/verify/${VALID_CERT_ID.toLowerCase()}`.toLowerCase());
    expect(openLinks[0].getAttribute('href')).toContain('chainId=31337');
    expect(openLinks[0].getAttribute('href')?.toLowerCase()).toContain(`registry=${REGISTRY_ADDRESS.toLowerCase()}`);
  });

  it('2. CertificateShareModal renders independent status facts, QR preview, and local-only notice', async () => {
    const handleClose = vi.fn();

    render(
      <CertificateShareModal
        isOpen={true}
        onClose={handleClose}
        certId={REVOKED_CERT_ID}
        chainId={31337}
        registryAddress={REGISTRY_ADDRESS}
        isRevoked={true}
        isIssuerAuthorized={false}
      />
    );

    // Header and Cert ID
    expect(screen.getByText('Share Verification Link & QR')).toBeTruthy();
    expect(screen.getByText(REVOKED_CERT_ID)).toBeTruthy();

    // Independent status facts preserved
    expect(screen.getByText('Permanently Revoked')).toBeTruthy();
    expect(screen.getByText('Issuer Deauthorized')).toBeTruthy();

    // Localhost warning displayed
    expect(screen.getByText(/Local-Only Link Notice/i)).toBeTruthy();

    // Live registry lookup explanation
    expect(screen.getByText(/Live Registry Lookup/i)).toBeTruthy();

    // Wait for QR image to generate
    await waitFor(() => {
      const qrImage = screen.getByAltText(`Verification QR code for certificate ${REVOKED_CERT_ID}`);
      expect(qrImage).toBeTruthy();
      expect(qrImage.getAttribute('src')?.startsWith('data:image/png;base64,')).toBe(true);
    });

    // Controls present
    expect(screen.getByRole('button', { name: /copy canonical verification link/i })).toBeTruthy();
    expect(screen.getByRole('link', { name: /open verification page in new tab/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /download qr code image as png/i })).toBeTruthy();
  });

  it('3. PublicCertificateVerifier exposes Share & QR controls for registered certificate', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: '0x3333333333333333333333333333333333333333333333333333333333333333',
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 0,
        revoked: false,
      },
      isIssuerCurrentlyAuthorized: true,
    });

    render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Share & Verification QR:')).toBeTruthy();
    });

    const shareButton = screen.getByRole('button', { name: /open share and qr modal/i });
    expect(shareButton).toBeTruthy();

    // Clicking share opens the modal
    fireEvent.click(shareButton);

    await waitFor(() => {
      const dialog = screen.getByRole('dialog');
      expect(within(dialog).getByText('Share Verification Link & QR')).toBeTruthy();
      expect(within(dialog).getByText('Active (Not Revoked)')).toBeTruthy();
      expect(within(dialog).getByText('Issuer Authorized')).toBeTruthy();
    });
  });
});
