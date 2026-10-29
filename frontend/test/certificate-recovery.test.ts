// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  savePendingRegistration,
  loadPendingRegistration,
  updatePendingRegistrationTxHash,
  clearPendingRegistration,
  PENDING_REGISTRATION_STORAGE_KEY,
  savePendingRevocation,
  loadPendingRevocation,
  updatePendingRevocationTxHash,
  clearPendingRevocation,
  PENDING_REVOCATION_STORAGE_KEY,
} from '@/lib/certificate/storage';
import { PendingRegistrationDraft } from '@/lib/certificate/types';

describe('Safe Pending-Operation Recovery & Session Storage Scoping', () => {
  const ACCOUNT_A = '0x1111111111111111111111111111111111111111';
  const ACCOUNT_B = '0x2222222222222222222222222222222222222222';
  const REGISTRY_1 = '0x5fbdb2315678afecb367f032d93f642f64180aa3';
  const REGISTRY_2 = '0x9999999999999999999999999999999999999999';
  const CHAIN_ANVIL = 31337;
  const CHAIN_SEPOLIA = 11155111;

  const validDraft: PendingRegistrationDraft = {
    certId: '0x1111111111111111111111111111111111111111111111111111111111111111',
    documentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    issuerAddress: ACCOUNT_A,
    chainId: CHAIN_ANVIL,
    registryAddress: REGISTRY_1,
    stage: 'prepared',
    timestamp: Date.now(),
  };

  beforeEach(() => {
    window.sessionStorage.clear();
  });

  it('saves and loads valid registration draft within identical scope', () => {
    savePendingRegistration(validDraft);
    const loaded = loadPendingRegistration({
      issuerAddress: ACCOUNT_A,
      chainId: CHAIN_ANVIL,
      registryAddress: REGISTRY_1,
    });

    expect(loaded).not.toBeNull();
    expect(loaded?.certId).toBe(validDraft.certId);
    expect(loaded?.documentHash).toBe(validDraft.documentHash);
    expect(loaded?.stage).toBe('prepared');
  });

  it('enforces account isolation: Account B cannot restore Account A pending operation', () => {
    savePendingRegistration(validDraft);
    const loaded = loadPendingRegistration({
      issuerAddress: ACCOUNT_B,
      chainId: CHAIN_ANVIL,
      registryAddress: REGISTRY_1,
    });

    expect(loaded).toBeNull();
  });

  it('enforces chain isolation: cannot restore when connected chain differs', () => {
    savePendingRegistration(validDraft);
    const loaded = loadPendingRegistration({
      issuerAddress: ACCOUNT_A,
      chainId: CHAIN_SEPOLIA,
      registryAddress: REGISTRY_1,
    });

    expect(loaded).toBeNull();
  });

  it('enforces contract deployment isolation: cannot restore when registry address differs', () => {
    savePendingRegistration(validDraft);
    const loaded = loadPendingRegistration({
      issuerAddress: ACCOUNT_A,
      chainId: CHAIN_ANVIL,
      registryAddress: REGISTRY_2,
    });

    expect(loaded).toBeNull();
  });

  it('rejects corrupted, malformed, or tampered storage data', () => {
    // Malformed JSON
    window.sessionStorage.setItem(PENDING_REGISTRATION_STORAGE_KEY, '{ invalid json');
    expect(
      loadPendingRegistration({
        issuerAddress: ACCOUNT_A,
        chainId: CHAIN_ANVIL,
        registryAddress: REGISTRY_1,
      })
    ).toBeNull();

    // Invalid certId format
    window.sessionStorage.setItem(
      PENDING_REGISTRATION_STORAGE_KEY,
      JSON.stringify({ ...validDraft, certId: 'not-a-hex' })
    );
    expect(
      loadPendingRegistration({
        issuerAddress: ACCOUNT_A,
        chainId: CHAIN_ANVIL,
        registryAddress: REGISTRY_1,
      })
    ).toBeNull();

    // Invalid stage
    window.sessionStorage.setItem(
      PENDING_REGISTRATION_STORAGE_KEY,
      JSON.stringify({ ...validDraft, stage: 'hacked_stage' })
    );
    expect(
      loadPendingRegistration({
        issuerAddress: ACCOUNT_A,
        chainId: CHAIN_ANVIL,
        registryAddress: REGISTRY_1,
      })
    ).toBeNull();
  });

  it('never stores PDF bytes, filenames, signatures, or session tokens in sessionStorage', () => {
    savePendingRegistration({
      ...validDraft,
      // Attempt to sneak unauthorized extra properties
      ...({
        pdfBytes: 'raw-binary-data',
        fileName: 'Secret_Certificate.pdf',
        signature: '0xsignature',
        sessionToken: 'secret_token',
      } as any),
    });

    const rawStored = window.sessionStorage.getItem(PENDING_REGISTRATION_STORAGE_KEY);
    expect(rawStored).not.toBeNull();
    const parsed = JSON.parse(rawStored!);

    expect(parsed.pdfBytes).toBeUndefined();
    expect(parsed.fileName).toBeUndefined();
    expect(parsed.signature).toBeUndefined();
    expect(parsed.sessionToken).toBeUndefined();
    expect(rawStored).not.toContain('Secret_Certificate.pdf');
    expect(rawStored).not.toContain('raw-binary-data');
  });

  it('updates draft with broadcasted txHash and sets stage to submitted', () => {
    savePendingRegistration(validDraft);
    const txHash = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    updatePendingRegistrationTxHash(txHash);

    const loaded = loadPendingRegistration({
      issuerAddress: ACCOUNT_A,
      chainId: CHAIN_ANVIL,
      registryAddress: REGISTRY_1,
    });

    expect(loaded?.stage).toBe('submitted');
    expect(loaded?.txHash).toBe(txHash);
  });

  it('clears pending registration completely on clearPendingRegistration', () => {
    savePendingRegistration(validDraft);
    clearPendingRegistration();
    expect(window.sessionStorage.getItem(PENDING_REGISTRATION_STORAGE_KEY)).toBeNull();
  });

  describe('Pending Revocation Recovery', () => {
    const validRevocationDraft: any = {
      operationType: 'revocation',
      certId: '0x1111111111111111111111111111111111111111111111111111111111111111',
      documentHash: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      issuerAddress: ACCOUNT_A,
      chainId: CHAIN_ANVIL,
      registryAddress: REGISTRY_1,
      stage: 'prepared',
      timestamp: Date.now(),
    };

    it('saves and loads valid revocation draft within identical scope', () => {
      savePendingRevocation(validRevocationDraft);
      const loaded = loadPendingRevocation({
        issuerAddress: ACCOUNT_A,
        chainId: CHAIN_ANVIL,
        registryAddress: REGISTRY_1,
      });

      expect(loaded).not.toBeNull();
      expect(loaded?.operationType).toBe('revocation');
      expect(loaded?.certId).toBe(validRevocationDraft.certId);
      expect(loaded?.issuerAddress.toLowerCase()).toBe(ACCOUNT_A.toLowerCase());
    });

    it('enforces account isolation on revocation draft', () => {
      savePendingRevocation(validRevocationDraft);
      const loaded = loadPendingRevocation({
        issuerAddress: ACCOUNT_B, // Different account
        chainId: CHAIN_ANVIL,
        registryAddress: REGISTRY_1,
      });

      expect(loaded).toBeNull();
    });

    it('enforces chain and contract deployment isolation on revocation draft', () => {
      savePendingRevocation(validRevocationDraft);

      // Different chain
      expect(
        loadPendingRevocation({
          issuerAddress: ACCOUNT_A,
          chainId: CHAIN_SEPOLIA,
          registryAddress: REGISTRY_1,
        })
      ).toBeNull();

      // Different registry contract
      expect(
        loadPendingRevocation({
          issuerAddress: ACCOUNT_A,
          chainId: CHAIN_ANVIL,
          registryAddress: REGISTRY_2,
        })
      ).toBeNull();
    });

    it('rejects tampered or corrupt revocation data', () => {
      window.sessionStorage.setItem(
        PENDING_REVOCATION_STORAGE_KEY,
        JSON.stringify({ ...validRevocationDraft, operationType: 'invalid_op' })
      );
      expect(
        loadPendingRevocation({
          issuerAddress: ACCOUNT_A,
          chainId: CHAIN_ANVIL,
          registryAddress: REGISTRY_1,
        })
      ).toBeNull();

      window.sessionStorage.setItem(
        PENDING_REVOCATION_STORAGE_KEY,
        JSON.stringify({ ...validRevocationDraft, certId: '0xshort' })
      );
      expect(
        loadPendingRevocation({
          issuerAddress: ACCOUNT_A,
          chainId: CHAIN_ANVIL,
          registryAddress: REGISTRY_1,
        })
      ).toBeNull();
    });

    it('updates revocation draft with broadcasted txHash and clears on clearPendingRevocation', () => {
      savePendingRevocation(validRevocationDraft);
      const txHash = '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
      updatePendingRevocationTxHash(txHash);

      const loaded = loadPendingRevocation({
        issuerAddress: ACCOUNT_A,
        chainId: CHAIN_ANVIL,
        registryAddress: REGISTRY_1,
      });
      expect(loaded?.stage).toBe('submitted');
      expect(loaded?.txHash).toBe(txHash);

      clearPendingRevocation();
      expect(
        loadPendingRevocation({
          issuerAddress: ACCOUNT_A,
          chainId: CHAIN_ANVIL,
          registryAddress: REGISTRY_1,
        })
      ).toBeNull();
    });
  });
});
