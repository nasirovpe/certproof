// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import CertificateRegistration from '@/components/certificate/CertificateRegistration';
import IssuerCertificateList from '@/components/certificate/IssuerCertificateList';
import { PENDING_REGISTRATION_STORAGE_KEY } from '@/lib/certificate/storage';
import * as registryLib from '@/lib/certificate/registry';

// Mock wagmi
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

describe('Certificate Components (Mocked-Wallet Coverage)', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockAccount = {
      address: '0x1111111111111111111111111111111111111111',
      isConnected: true,
    };
    mockChainId = 31337;
    mockWriteContractAsync.mockReset();
    mockWaitForTransactionReceipt.mockReset();
    mockGetTransactionReceipt.mockReset();
  });

  describe('CertificateRegistration Component', () => {
    it('renders initial dropzone with format heuristics, zero upload, and legal boundary disclosures', () => {
      render(<CertificateRegistration />);

      expect(screen.getByText(/Register Certificate/i)).toBeDefined();
      expect(screen.getByText(/Privacy & Verification Boundaries/i)).toBeDefined();
      expect(screen.getByText(/Enforces a 32 MB limit/i)).toBeDefined();
      expect(screen.getByText(/Zero Server Upload/i)).toBeDefined();
      expect(screen.getByText(/Legal Boundary/i)).toBeDefined();
      expect(screen.getByText(/Click to choose PDF or drag and drop/i)).toBeDefined();
    });

    it('rejects empty file (0 bytes) before processing', async () => {
      render(<CertificateRegistration />);
      const fileInput = document.getElementById('certificate-file-input') as HTMLInputElement;

      const emptyFile = new File([], 'empty.pdf', { type: 'application/pdf' });
      fireEvent.change(fileInput, { target: { files: [emptyFile] } });

      await waitFor(() => {
        expect(screen.getByText(/The selected file is empty \(0 bytes\)/i)).toBeDefined();
      });
    });

    it('rejects oversized file (>32 MB) before reading into memory', async () => {
      render(<CertificateRegistration />);
      const fileInput = document.getElementById('certificate-file-input') as HTMLInputElement;

      // Mock oversized file
      const bigFile = new File(['x'], 'huge.pdf', { type: 'application/pdf' });
      Object.defineProperty(bigFile, 'size', { value: 33 * 1024 * 1024 });

      fireEvent.change(fileInput, { target: { files: [bigFile] } });

      await waitFor(() => {
        expect(screen.getByText(/File exceeds maximum permitted size of 32 MB/i)).toBeDefined();
      });
    });

    it('detects pre-broadcast draft from sessionStorage and requires file re-selection', async () => {
      window.sessionStorage.setItem(
        PENDING_REGISTRATION_STORAGE_KEY,
        JSON.stringify({
          certId: '0x1111111111111111111111111111111111111111111111111111111111111111',
          documentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
          issuerAddress: '0x1111111111111111111111111111111111111111',
          chainId: 31337,
          registryAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
          stage: 'prepared',
          timestamp: Date.now(),
        })
      );

      render(<CertificateRegistration />);

      await waitFor(() => {
        expect(screen.getByText(/Pending Registration Draft Detected from Session/i)).toBeDefined();
        expect(
          screen.getByText(/Because PDF bytes are strictly memory-only/i)
        ).toBeDefined();
        expect(screen.getByText(/Discard Draft/i)).toBeDefined();
      });
    });

    it('handles user wallet rejection gracefully without losing frozen parameters', async () => {
      vi.spyOn(registryLib, 'checkCertificateIdAvailable').mockResolvedValue(true);
      vi.spyOn(registryLib, 'simulateCertificateRegistration').mockResolvedValue({ success: true });

      render(<CertificateRegistration />);

      // Create a valid synthetic PDF content
      const pdfBytes = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\n0\n%%EOF\n';
      const file = new File([pdfBytes], 'test.pdf', { type: 'application/pdf' });
      const fileInput = document.getElementById('certificate-file-input') as HTMLInputElement;

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/Frozen Registration Summary/i)).toBeDefined();
      });

      // Wallet rejects with 4001 user denial
      mockWriteContractAsync.mockRejectedValueOnce(
        new Error('User rejected the request. (code: 4001)')
      );

      const confirmBtn = screen.getByText(/Confirm & Register on Blockchain/i);
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(
          screen.getByText(/Transaction was cancelled in your wallet. The document was not registered./i)
        ).toBeDefined();
        // Frozen registration summary is preserved
        expect(screen.getByText(/Frozen Registration Summary/i)).toBeDefined();
      });
    });

    it('handles uncertain transaction receipt status and forbids duplicate broadcast', async () => {
      vi.spyOn(registryLib, 'checkCertificateIdAvailable').mockResolvedValue(true);
      vi.spyOn(registryLib, 'simulateCertificateRegistration').mockResolvedValue({ success: true });

      render(<CertificateRegistration />);

      const pdfBytes = '%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\nstartxref\n0\n%%EOF\n';
      const file = new File([pdfBytes], 'test.pdf', { type: 'application/pdf' });
      const fileInput = document.getElementById('certificate-file-input') as HTMLInputElement;

      fireEvent.change(fileInput, { target: { files: [file] } });

      await waitFor(() => {
        expect(screen.getByText(/Frozen Registration Summary/i)).toBeDefined();
      });

      const txHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      mockWriteContractAsync.mockResolvedValueOnce(txHash);
      // Wait for receipt times out
      mockWaitForTransactionReceipt.mockRejectedValueOnce(
        new Error('RPC request timed out waiting for receipt')
      );

      const confirmBtn = screen.getByText(/Confirm & Register on Blockchain/i);
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(screen.getByText(/Uncertain Transaction Receipt Status/i)).toBeDefined();
        expect(
          screen.getByText(/Do NOT submit a duplicate registration transaction/i)
        ).toBeDefined();
        expect(screen.getByText(/Check Existing Transaction Status/i)).toBeDefined();
      });
    });
  });

  describe('IssuerCertificateList Component', () => {
    it('displays distinct dimensions: registration, revocation facts, and authorization', async () => {
      vi.spyOn(registryLib, 'fetchIssuerCertificates').mockResolvedValue({
        items: [
          {
            certId: '0x1111111111111111111111111111111111111111111111111111111111111111',
            documentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            issuer: '0x1111111111111111111111111111111111111111',
            registeredAt: 1700000000,
            revokedAt: 0,
            revoked: false,
            isIssuerCurrentlyAuthorized: true,
          },
          {
            certId: '0x2222222222222222222222222222222222222222222222222222222222222222',
            documentHash: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
            issuer: '0x1111111111111111111111111111111111111111',
            registeredAt: 1700001000,
            revokedAt: 1700002000,
            revoked: true,
            isIssuerCurrentlyAuthorized: false,
          },
        ],
        total: 2,
        nextOffset: 2,
      });

      render(<IssuerCertificateList />);

      await waitFor(() => {
        expect(screen.getByText(/Issued Certificates/i)).toBeDefined();
        expect(screen.getByText('Active')).toBeDefined();
        expect(screen.getByText('Revoked')).toBeDefined();
        expect(screen.getByText('Authorized')).toBeDefined();
        expect(screen.getByText('De-authorized')).toBeDefined();
        expect(
          screen.getByText(/Registration existence, revocation status, and current issuer authorization are independent operational facts/i)
        ).toBeDefined();
      });
    });

    it('renders empty list state when issuer has no registered certificates', async () => {
      vi.spyOn(registryLib, 'fetchIssuerCertificates').mockResolvedValue({
        items: [],
        total: 0,
        nextOffset: 0,
      });

      render(<IssuerCertificateList />);

      await waitFor(() => {
        expect(screen.getByText(/No Certificates Registered/i)).toBeDefined();
      });
    });

    it('clears list immediately upon wallet account change to prevent cross-account display', async () => {
      const fetchSpy = vi.spyOn(registryLib, 'fetchIssuerCertificates').mockResolvedValue({
        items: [
          {
            certId: '0x1111111111111111111111111111111111111111111111111111111111111111',
            documentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            issuer: '0x1111111111111111111111111111111111111111',
            registeredAt: 1700000000,
            revokedAt: 0,
            revoked: false,
            isIssuerCurrentlyAuthorized: true,
          },
        ],
        total: 1,
        nextOffset: 1,
      });

      const { rerender } = render(<IssuerCertificateList />);

      await waitFor(() => {
        expect(screen.getByText('Active')).toBeDefined();
      });

      // Switch account
      mockAccount = {
        address: '0x2222222222222222222222222222222222222222',
        isConnected: true,
      };

      // Account B has 0 certs
      fetchSpy.mockResolvedValueOnce({
        items: [],
        total: 0,
        nextOffset: 0,
      });

      rerender(<IssuerCertificateList />);

      await waitFor(() => {
        expect(screen.queryByText('Active')).toBeNull();
        expect(screen.getByText(/No Certificates Registered/i)).toBeDefined();
      });
    });
  });
});
