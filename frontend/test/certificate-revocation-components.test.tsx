// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import IssuerCertificateList from '@/components/certificate/IssuerCertificateList';
import RevocationDialog from '@/components/certificate/RevocationDialog';
import IssuerPage from '@/app/issuer/page';
import { PENDING_REVOCATION_STORAGE_KEY } from '@/lib/certificate/storage';
import * as registryLib from '@/lib/certificate/registry';

// Mock Wagmi
let mockAccount = {
  address: '0x1111111111111111111111111111111111111111' as string | undefined,
  isConnected: true,
};
let mockChainId = 31337;

const mockWriteContractAsync = vi.fn();
const mockWaitForTransactionReceipt = vi.fn();
const mockGetTransactionReceipt = vi.fn();

const mockPublicClient = {
  waitForTransactionReceipt: mockWaitForTransactionReceipt,
  getTransactionReceipt: mockGetTransactionReceipt,
  readContract: vi.fn(),
  simulateContract: vi.fn(),
};

vi.mock('wagmi', () => ({
  createConfig: vi.fn(),
  http: vi.fn(),
  useAccount: () => mockAccount,
  useChainId: () => mockChainId,
  useWriteContract: () => ({
    writeContractAsync: mockWriteContractAsync,
    isPending: false,
  }),
  usePublicClient: () => mockPublicClient,
}));

vi.mock('@/lib/config/env', () => ({
  getClientEnv: () => ({
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_CHAIN_ID: 31337,
    NEXT_PUBLIC_REGISTRY_ADDRESS: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
    NEXT_PUBLIC_ANVIL_RPC_URL: 'http://127.0.0.1:8545',
  }),
}));

let mockSession = {
  authenticated: true,
  address: '0x1111111111111111111111111111111111111111',
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
};

vi.mock('@/context/SessionContext', () => ({
  useSession: () => ({
    session: mockSession,
    loading: false,
    signIn: vi.fn(),
    logout: vi.fn(),
  }),
}));

describe('Certificate Revocation UI Components (Mocked-Wallet Coverage)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockAccount = {
      address: '0x1111111111111111111111111111111111111111',
      isConnected: true,
    };
    mockSession = {
      authenticated: true,
      address: '0x1111111111111111111111111111111111111111',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
    mockChainId = 31337;
    mockWriteContractAsync.mockReset();
    mockWaitForTransactionReceipt.mockReset();
    mockGetTransactionReceipt.mockReset();
  });

  const sampleCert: registryLib.IssuerCertificateItem = {
    certId: '0x1111111111111111111111111111111111111111111111111111111111111111',
    documentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    issuer: '0x1111111111111111111111111111111111111111',
    registeredAt: 1700000000,
    revokedAt: 0,
    revoked: false,
    isIssuerCurrentlyAuthorized: true,
  };

  describe('RevocationDialog Component', () => {
    it('renders dialog with certificate ID, document hash, issuer, network, and educational notices', () => {
      render(
        <RevocationDialog
          certificate={sampleCert}
          isOpen={true}
          onClose={vi.fn()}
          onRevocationSuccess={vi.fn()}
        />
      );

      expect(screen.getByText(/Permanent Certificate Revocation/i)).toBeDefined();
      expect(screen.getByText(sampleCert.certId)).toBeDefined();
      expect(screen.getByText(sampleCert.documentHash)).toBeDefined();
      expect(screen.getByText(/Irreversible Blockchain Record Update/i)).toBeDefined();
      expect(screen.getByText(/Record update only/i)).toBeDefined();
      expect(screen.getByText(/Zero-PDF Requirement/i)).toBeDefined();
      expect(screen.getByText(/Confirm Permanent Revocation/i)).toBeDefined();
    });

    it('closes on Escape key press when idle', () => {
      const onCloseSpy = vi.fn();
      render(
        <RevocationDialog
          certificate={sampleCert}
          isOpen={true}
          onClose={onCloseSpy}
          onRevocationSuccess={vi.fn()}
        />
      );

      fireEvent.keyDown(window, { key: 'Escape' });
      expect(onCloseSpy).toHaveBeenCalled();
    });

    it('handles wallet rejection gracefully without losing frozen parameters', async () => {
      vi.spyOn(registryLib, 'simulateCertificateRevocation').mockResolvedValue({ success: true });

      render(
        <RevocationDialog
          certificate={sampleCert}
          isOpen={true}
          onClose={vi.fn()}
          onRevocationSuccess={vi.fn()}
        />
      );

      mockWriteContractAsync.mockRejectedValueOnce(
        new Error('User rejected the request. (code: 4001)')
      );

      const confirmBtn = screen.getByText(/Confirm Permanent Revocation/i);
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/Transaction request was rejected or cancelled in your wallet/i)
        ).toBeDefined();
        // Frozen parameters remain visible
        expect(screen.getByText(sampleCert.certId)).toBeDefined();
      });
    });

    it('handles uncertain receipt status and offers "Check Transaction Status" without rebroadcasting', async () => {
      vi.spyOn(registryLib, 'simulateCertificateRevocation').mockResolvedValue({ success: true });

      const fakeTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      mockWriteContractAsync.mockResolvedValueOnce(fakeTxHash);
      mockWaitForTransactionReceipt.mockRejectedValueOnce(new Error('Receipt timeout'));

      render(
        <RevocationDialog
          certificate={sampleCert}
          isOpen={true}
          onClose={vi.fn()}
          onRevocationSuccess={vi.fn()}
        />
      );

      const confirmBtn = screen.getByText(/Confirm Permanent Revocation/i);
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(screen.getByText(/Transaction Receipt Pending/i)).toBeDefined();
        expect(screen.getByText(fakeTxHash)).toBeDefined();
        expect(screen.getByText(/Check Transaction Status/i)).toBeDefined();
      });
    });

    it('completes revocation workflow upon receipt confirmation and reconciles state', async () => {
      vi.spyOn(registryLib, 'simulateCertificateRevocation').mockResolvedValue({ success: true });
      const fakeTxHash = '0x9999999999999999999999999999999999999999999999999999999999999999';
      mockWriteContractAsync.mockResolvedValueOnce(fakeTxHash);

      mockWaitForTransactionReceipt.mockResolvedValueOnce({
        status: 'success',
        logs: [],
      });

      vi.spyOn(registryLib, 'verifyCertificateRevokedReceipt').mockReturnValue({
        verified: true,
        revokedAt: 1700005000,
        logIndex: 0,
      });

      vi.spyOn(registryLib, 'reconcileRevokedCertificate').mockResolvedValue({
        ...sampleCert,
        revoked: true,
        revokedAt: 1700005000,
      });

      const onSuccessSpy = vi.fn();
      render(
        <RevocationDialog
          certificate={sampleCert}
          isOpen={true}
          onClose={vi.fn()}
          onRevocationSuccess={onSuccessSpy}
        />
      );

      const confirmBtn = screen.getByText(/Confirm Permanent Revocation/i);
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(screen.getByText(/Revocation Confirmed on Blockchain/i)).toBeDefined();
        expect(screen.getByText(/Authoritative Revoked At:/i)).toBeDefined();
        expect(onSuccessSpy).toHaveBeenCalledWith(sampleCert.certId, 1700005000);
      });
    });
  });

  describe('IssuerCertificateList with Revocation Integration', () => {
    it('enables Revoke button only for active certificates owned by the connected wallet', async () => {
      vi.spyOn(registryLib, 'fetchIssuerCertificates').mockResolvedValue({
        items: [
          sampleCert, // active, owned by 0x1111...
          {
            certId: '0x2222222222222222222222222222222222222222222222222222222222222222',
            documentHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            issuer: '0x1111111111111111111111111111111111111111',
            registeredAt: 1700001000,
            revokedAt: 1700002000,
            revoked: true,
            isIssuerCurrentlyAuthorized: true,
          },
        ],
        total: 2,
        nextOffset: 2,
      });

      render(<IssuerCertificateList />);

      await waitFor(() => {
        expect(screen.getByText('Active')).toBeDefined();
        expect(screen.getByText('Revoked')).toBeDefined();
      });

      // Active cert has clickable "Revoke" button
      const revokeButtons = screen.getAllByRole('button', { name: /Revoke/i });
      expect(revokeButtons.length).toBe(1);
      expect(revokeButtons[0].getAttribute('disabled')).toBeNull();

      // Clicking Revoke opens dialog
      fireEvent.click(revokeButtons[0]);
      await waitFor(() => {
        expect(screen.getByText(/Permanent Certificate Revocation/i)).toBeDefined();
      });
    });

    it('restores pending revocation from sessionStorage upon refresh', async () => {
      window.sessionStorage.setItem(
        PENDING_REVOCATION_STORAGE_KEY,
        JSON.stringify({
          operationType: 'revocation',
          certId: '0x1111111111111111111111111111111111111111111111111111111111111111',
          documentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          issuerAddress: '0x1111111111111111111111111111111111111111',
          chainId: 31337,
          registryAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
          txHash: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd',
          stage: 'submitted',
          timestamp: Date.now(),
        })
      );

      vi.spyOn(registryLib, 'fetchIssuerCertificates').mockResolvedValue({
        items: [sampleCert],
        total: 1,
        nextOffset: 1,
      });

      render(<IssuerCertificateList />);

      await waitFor(() => {
        expect(screen.getByText(/Permanent Certificate Revocation/i)).toBeDefined();
        expect(screen.getByText(/0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd/i)).toBeDefined();
      });
    });
  });

  describe('IssuerPage Authorization Decoupling', () => {
    it('preserves certificate history and revocation for deauthorized issuer while hiding registration', async () => {
      // Mock /api/issuer/status returning deauthorized issuer
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('/api/issuer/status')) {
          return Promise.resolve({
            ok: true,
            status: 200,
            json: async () => ({
              authenticated: true,
              walletAddress: '0x1111111111111111111111111111111111111111',
              registryAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
              chainId: 31337,
              contractDeployed: true,
              isAuthorized: false, // DEAUTHORIZED!
            }),
          });
        }
        return Promise.reject(new Error('Unknown URL'));
      });

      vi.spyOn(registryLib, 'fetchIssuerCertificates').mockResolvedValue({
        items: [
          {
            ...sampleCert,
            isIssuerCurrentlyAuthorized: false,
          },
        ],
        total: 1,
        nextOffset: 1,
      });

      render(<IssuerPage />);

      await waitFor(() => {
        // 1. Shows "Issuer Not Authorized On-Chain" banner
        expect(screen.getByText(/Issuer Not Authorized On-Chain/i)).toBeDefined();
        // 2. Explains that new registration is disabled but existing certs remain revokable
        expect(
          screen.getByText(/New certificate registration is disabled. However, any previously issued certificates remain accessible in your certificate history below/i)
        ).toBeDefined();
        // 3. Certificate registration form is NOT rendered
        expect(screen.queryByText(/Register Certificate/i)).toBeNull();
        expect(screen.queryByText(/Click to choose PDF or drag and drop/i)).toBeNull();
        // 4. Issued Certificates table IS rendered with Revoke button!
        expect(screen.getByRole('heading', { name: /Issued Certificates/i })).toBeDefined();
        expect(screen.getByRole('button', { name: /Revoke/i })).toBeDefined();
      });
    });
  });
});
