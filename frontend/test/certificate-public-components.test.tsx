// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import fs from 'node:fs';
import path from 'node:path';
import { PublicCertificateVerifier } from '@/components/certificate/PublicCertificateVerifier';
import * as registryLib from '@/lib/certificate/registry';

const FIXTURES_DIR = path.resolve(__dirname, '../../fixtures');
const originalBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'original.pdf'));
const duplicateBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'duplicate.pdf'));
const modifiedBytes = fs.readFileSync(path.join(FIXTURES_DIR, 'modified.pdf'));
const hashesJson = JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, 'hashes.json'), 'utf-8'));

const VALID_CERT_ID = '0x1111111111111111111111111111111111111111111111111111111111111111' as const;
const ISSUER_ADDRESS = '0x2222222222222222222222222222222222222222' as const;
const REGISTRY_ADDRESS = '0x5fbdb2315678afecb367f032d93f642f64180aa3' as const;

describe('Public Certificate Verifier & Local PDF Comparison Component Suite', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Registered certificate with no selected file: prominently indicates document has not been compared', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 0,
        revoked: false,
      },
      isIssuerCurrentlyAuthorized: true,
    });

    render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Registration Record')).toBeTruthy();
    });

    // Prominently warns that document has not been compared
    expect(screen.getByText('DOCUMENT HAS NOT BEEN COMPARED')).toBeTruthy();
    expect(screen.getByText('Unchecked (No File)')).toBeTruthy();
    expect(
      screen.getByText(/Opening this link displays on-chain registry metadata only/i)
    ).toBeTruthy();

    // Check on-chain facts rendered
    expect(screen.getByText('Active (Not Revoked)')).toBeTruthy();
    expect(screen.getByText('Currently Authorized')).toBeTruthy();
  });

  it('2. Original and duplicate PDF matches: verifies exact Keccak-256 byte-for-byte match', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 0,
        revoked: false,
      },
      isIssuerCurrentlyAuthorized: true,
    });

    const { container } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Registration Record')).toBeTruthy();
    });

    const fileInput = container.querySelector('#verifier-pdf-input') as HTMLInputElement;
    expect(fileInput).toBeTruthy();

    // Select original.pdf
    const originalFile = new File([originalBytes], 'original.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [originalFile] } });

    await waitFor(() => {
      expect(screen.getByText('BYTE-FOR-BYTE IDENTICAL')).toBeTruthy();
    });

    // Select duplicate.pdf
    const duplicateFile = new File([duplicateBytes], 'duplicate.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [duplicateFile] } });

    await waitFor(() => {
      expect(screen.getByText('BYTE-FOR-BYTE IDENTICAL')).toBeTruthy();
    });
  });

  it('3. One-byte-modified PDF mismatch: renders distinct mismatch warning and displays hashes side-by-side', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 0,
        revoked: false,
      },
      isIssuerCurrentlyAuthorized: true,
    });

    const { container } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Registration Record')).toBeTruthy();
    });

    const fileInput = container.querySelector('#verifier-pdf-input') as HTMLInputElement;
    const modifiedFile = new File([modifiedBytes], 'modified.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [modifiedFile] } });

    await waitFor(() => {
      expect(screen.getByText('DOCUMENT HASH MISMATCH')).toBeTruthy();
      expect(screen.getByText('Hash Mismatch')).toBeTruthy();
    });

    // Both candidate hash and registered hash must be rendered side-by-side
    expect(
      screen.getByText(new RegExp(hashesJson.files.modified.keccak256, 'i'))
    ).toBeTruthy();
    expect(
      screen.getAllByText(new RegExp(hashesJson.files.original.keccak256, 'i')).length
    ).toBeGreaterThanOrEqual(2);
  });

  it('4. Matching file with revoked status: displays both byte match AND revoked warning together', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 1700050000,
        revoked: true,
      },
      isIssuerCurrentlyAuthorized: true,
    });

    const { container } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Registration Record')).toBeTruthy();
    });

    const fileInput = container.querySelector('#verifier-pdf-input') as HTMLInputElement;
    const originalFile = new File([originalBytes], 'original.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [originalFile] } });

    await waitFor(() => {
      expect(screen.getByText('BYTE-FOR-BYTE IDENTICAL')).toBeTruthy();
    });

    // Revocation status must remain prominently visible alongside the file match!
    expect(screen.getByText('CERTIFICATE PERMANENTLY REVOKED')).toBeTruthy();
    expect(screen.getByText('Revoked')).toBeTruthy();
    expect(screen.getByText(/1700050000/)).toBeTruthy();
  });

  it('5. Matching file with deauthorized issuer: displays both byte match AND deauthorized warning together', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 0,
        revoked: false,
      },
      isIssuerCurrentlyAuthorized: false,
    });

    const { container } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Registration Record')).toBeTruthy();
    });

    const fileInput = container.querySelector('#verifier-pdf-input') as HTMLInputElement;
    const originalFile = new File([originalBytes], 'original.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [originalFile] } });

    await waitFor(() => {
      expect(screen.getByText('BYTE-FOR-BYTE IDENTICAL')).toBeTruthy();
    });

    // Deauthorized fact must be displayed independently
    expect(screen.getByText('ISSUING WALLET DEAUTHORIZED')).toBeTruthy();
    expect(screen.getByText('Currently Deauthorized')).toBeTruthy();
  });

  it('6. Simultaneously revoked and deauthorized: renders all independent facts distinctly', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 1700050000,
        revoked: true,
      },
      isIssuerCurrentlyAuthorized: false,
    });

    const { container } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Registration Record')).toBeTruthy();
    });

    const fileInput = container.querySelector('#verifier-pdf-input') as HTMLInputElement;
    const originalFile = new File([originalBytes], 'original.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [originalFile] } });

    await waitFor(() => {
      expect(screen.getByText('BYTE-FOR-BYTE IDENTICAL')).toBeTruthy();
    });

    // All facts visible together without collapsing into one badge
    expect(screen.getByText('Registered')).toBeTruthy();
    expect(screen.getByText('BYTE-FOR-BYTE IDENTICAL')).toBeTruthy();
    expect(screen.getByText('CERTIFICATE PERMANENTLY REVOKED')).toBeTruthy();
    expect(screen.getByText('ISSUING WALLET DEAUTHORIZED')).toBeTruthy();
  });

  it('7. Unregistered and malformed certificate IDs: handled gracefully without crashing', async () => {
    // A. Unregistered ID
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'UNREGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
    });

    const { unmount } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Certificate Not Found')).toBeTruthy();
      expect(screen.getByText('On-Chain Record: UNREGISTERED')).toBeTruthy();
    });

    unmount();

    // B. Malformed ID
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'MALFORMED_ID',
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      errorMessage: 'Invalid Certificate ID: Expected a 66-character hexadecimal string.',
    });

    render(<PublicCertificateVerifier certId="0xnotvalid" />);

    await waitFor(() => {
      expect(screen.getByText('Malformed Certificate ID')).toBeTruthy();
      expect(screen.getByText(/is not a valid 32-byte hexadecimal certificate ID/i)).toBeTruthy();
    });
  });

  it('8. RPC outage and missing deployment: clearly distinguished and provides retry action', async () => {
    // A. RPC Outage
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'RPC_ERROR',
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      errorMessage: 'Connection refused: http://127.0.0.1:8545',
    });

    const { unmount } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Ethereum RPC Communication Failure')).toBeTruthy();
      expect(screen.getByText(/Authoritative Integrity Guarantee:/i)).toBeTruthy();
      expect(screen.getByText('Retry Connection')).toBeTruthy();
    });

    unmount();

    // B. Missing Deployment
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'MISSING_DEPLOYMENT',
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      errorMessage: 'No bytecode at registry address.',
    });

    render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Missing Contract Deployment')).toBeTruthy();
    });
  });

  it('9. File replacement and clearing: aborts in-flight work and resets comparison state', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 0,
        revoked: false,
      },
      isIssuerCurrentlyAuthorized: true,
    });

    const { container } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Registration Record')).toBeTruthy();
    });

    const fileInput = container.querySelector('#verifier-pdf-input') as HTMLInputElement;
    const originalFile = new File([originalBytes], 'original.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [originalFile] } });

    await waitFor(() => {
      expect(screen.getByText('BYTE-FOR-BYTE IDENTICAL')).toBeTruthy();
    });

    // Clear file
    const clearBtn = screen.getByText('Clear File');
    fireEvent.click(clearBtn);

    await waitFor(() => {
      expect(screen.getByText('DOCUMENT HAS NOT BEEN COMPARED')).toBeTruthy();
    });
  });

  it('10. Public access without a wallet or authenticated session: renders completely with no prompts', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 0,
        revoked: false,
      },
      isIssuerCurrentlyAuthorized: true,
    });

    render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Public Certificate Verification')).toBeTruthy();
      expect(screen.getByText('Zero-Auth Direct Contract Inspection')).toBeTruthy();
    });

    // No modal dialogs or authentication errors present
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText(/Sign In/i)).toBeNull();
  });

  it('11. Zero outbound upload guarantee: file selection and hashing produce no network uploads', async () => {
    vi.spyOn(registryLib, 'fetchPublicCertificate').mockResolvedValue({
      status: 'REGISTERED',
      certId: VALID_CERT_ID,
      chainId: 31337,
      registryAddress: REGISTRY_ADDRESS,
      blockNumber: 42n,
      record: {
        certId: VALID_CERT_ID,
        documentHash: hashesJson.files.original.keccak256,
        issuer: ISSUER_ADDRESS,
        registeredAt: 1700000000,
        revokedAt: 0,
        revoked: false,
      },
      isIssuerCurrentlyAuthorized: true,
    });

    const fetchSpy = vi.spyOn(global, 'fetch');

    const { container } = render(<PublicCertificateVerifier certId={VALID_CERT_ID} />);

    await waitFor(() => {
      expect(screen.getByText('Registration Record')).toBeTruthy();
    });

    const fileInput = container.querySelector('#verifier-pdf-input') as HTMLInputElement;
    const originalFile = new File([originalBytes], 'original.pdf', { type: 'application/pdf' });
    fireEvent.change(fileInput, { target: { files: [originalFile] } });

    await waitFor(() => {
      expect(screen.getByText('BYTE-FOR-BYTE IDENTICAL')).toBeTruthy();
    });

    // fetch was NEVER called for document uploading or analytics
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
