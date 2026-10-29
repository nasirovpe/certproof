'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { Hex, createPublicClient, http } from 'viem';
import { CertProofRegistryABI } from '@/lib/abi/CertProofRegistry';
import { anvilChain } from '@/lib/config/chains';
import { getClientEnv } from '@/lib/config/env';
import { IssuerCertificateItem, PendingRevocationDraft } from '@/lib/certificate/types';
import {
  simulateCertificateRevocation,
  verifyCertificateRevokedReceipt,
  reconcileRevokedCertificate,
} from '@/lib/certificate/registry';
import {
  savePendingRevocation,
  updatePendingRevocationTxHash,
  clearPendingRevocation,
} from '@/lib/certificate/storage';

export type RevocationStep =
  | 'confirm'
  | 'simulating'
  | 'waiting_wallet'
  | 'broadcasting'
  | 'confirming'
  | 'confirmed'
  | 'unknown_receipt'
  | 'error';

interface RevocationDialogProps {
  certificate: IssuerCertificateItem;
  isOpen: boolean;
  onClose: () => void;
  onRevocationSuccess: (certId: Hex, revokedAt: number) => void;
  initialTxHash?: Hex;
}

export default function RevocationDialog({
  certificate,
  isOpen,
  onClose,
  onRevocationSuccess,
  initialTxHash,
}: RevocationDialogProps) {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const wagmiPublicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();

  const clientEnv = getClientEnv();
  const targetChainId = clientEnv.NEXT_PUBLIC_CHAIN_ID;
  const registryAddress = clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS;
  const rpcUrl =
    targetChainId === 31337
      ? clientEnv.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545'
      : clientEnv.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';

  const wagmiPublicClientRef = useRef(wagmiPublicClient);
  useEffect(() => {
    wagmiPublicClientRef.current = wagmiPublicClient;
  }, [wagmiPublicClient]);

  const getActiveClient = useCallback(() => {
    if (wagmiPublicClientRef.current) return wagmiPublicClientRef.current;
    return createPublicClient({
      chain: anvilChain,
      transport: http(rpcUrl),
    });
  }, [rpcUrl]);

  // Frozen operation parameters
  const frozenCertIdRef = useRef<Hex>(certificate.certId);
  const frozenDocumentHashRef = useRef<Hex>(certificate.documentHash);
  const frozenIssuerRef = useRef<Hex>(certificate.issuer);

  const [step, setStep] = useState<RevocationStep>(initialTxHash ? 'confirming' : 'confirm');
  const [txHash, setTxHash] = useState<Hex | null>(initialTxHash || null);
  const [revokedTimestamp, setRevokedTimestamp] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);

  // Active address ref to discard stale responses on account switch
  const activeAddressRef = useRef<string | undefined>(address);
  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  // Focus management & accessibility
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null);

  const handleClose = useCallback(() => {
    if (step === 'broadcasting' || step === 'confirming') {
      return; // Do not close modal during active in-flight contract confirmation
    }
    onClose();
  }, [step, onClose]);

  // Reset or initialize on open / certificate change
  useEffect(() => {
    if (isOpen) {
      frozenCertIdRef.current = certificate.certId;
      frozenDocumentHashRef.current = certificate.documentHash;
      frozenIssuerRef.current = certificate.issuer;
      if (initialTxHash) {
        setStep('confirming');
        setTxHash(initialTxHash);
      } else {
        setStep('confirm');
        setTxHash(null);
      }
      setRevokedTimestamp(null);
      setErrorMessage(null);
      setErrorType(null);

      // Focus management
      setTimeout(() => {
        cancelButtonRef.current?.focus();
      }, 50);
    }
  }, [isOpen, certificate, initialTxHash]);

  // Keyboard navigation: Escape key closes modal unless transaction is broadcasting or confirming
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (step !== 'broadcasting' && step !== 'confirming') {
          handleClose();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, step, handleClose]);

  // If connected wallet or chain changes while dialog is open, immediately close to prevent cross-account actions
  useEffect(() => {
    if (isOpen) {
      if (!isConnected || !address || currentChainId !== targetChainId) {
        onClose();
      } else if (certificate.issuer.toLowerCase() !== address.toLowerCase()) {
        onClose();
      }
    }
  }, [isOpen, isConnected, address, currentChainId, targetChainId, certificate.issuer, onClose]);

  // Reconcile pending transaction status
  const checkTransactionStatus = useCallback(
    async (hashToCheck: Hex) => {
      const client = getActiveClient();
      setStep('confirming');
      setErrorMessage(null);

      try {
        const receipt = await client.getTransactionReceipt({ hash: hashToCheck });
        if (!receipt) {
          // Still pending on-chain
          setStep('unknown_receipt');
          return;
        }

        const verification = verifyCertificateRevokedReceipt(receipt, registryAddress, {
          certId: frozenCertIdRef.current,
          issuer: frozenIssuerRef.current,
        });

        if (!verification.verified) {
          setStep('error');
          setErrorType('RECEIPT_FAILED');
          setErrorMessage(verification.error || 'Revocation receipt verification failed.');
          return;
        }

        // Direct contract read to reconcile final authoritative state
        const reconciled = await reconcileRevokedCertificate(
          client,
          registryAddress,
          frozenCertIdRef.current
        );

        if (!reconciled.revoked) {
          setStep('error');
          setErrorType('RECONCILIATION_FAILED');
          setErrorMessage('Registry read indicates certificate was not revoked.');
          return;
        }

        const authoritativeRevokedAt = verification.revokedAt || reconciled.revokedAt;
        setRevokedTimestamp(authoritativeRevokedAt);
        setStep('confirmed');
        clearPendingRevocation();
        onRevocationSuccess(frozenCertIdRef.current, authoritativeRevokedAt);
      } catch (err: unknown) {
        console.warn('[REVOKE] Receipt verification error:', err);
        setStep('unknown_receipt');
        setErrorMessage(
          err instanceof Error ? err.message : 'Transaction status could not be verified yet.'
        );
      }
    },
    [getActiveClient, registryAddress, onRevocationSuccess]
  );

  // Auto-check if opened with an initial txHash from sessionStorage recovery
  useEffect(() => {
    if (isOpen && initialTxHash && step === 'confirming') {
      checkTransactionStatus(initialTxHash);
    }
  }, [isOpen, initialTxHash, step, checkTransactionStatus]);

  // Execution: Pre-read simulation -> Freeze -> Write contract -> Event validation -> State reconciliation
  const executeRevocation = async () => {
    if (!isConnected || !address || currentChainId !== targetChainId) {
      setStep('error');
      setErrorType('ENVIRONMENT_MISMATCH');
      setErrorMessage('Wallet disconnected or incorrect network.');
      return;
    }

    if (certificate.issuer.toLowerCase() !== address.toLowerCase()) {
      setStep('error');
      setErrorType('NOT_ISSUER');
      setErrorMessage('Access denied: You are not the original issuer of this certificate.');
      return;
    }

    const executingAddress = address;
    const certIdToRevoke = frozenCertIdRef.current;
    const docHashToRevoke = frozenDocumentHashRef.current;

    setStep('simulating');
    setErrorMessage(null);
    setErrorType(null);

    const client = getActiveClient();

    // 1. Pre-flight Check & Contract Simulation
    const simResult = await simulateCertificateRevocation(
      client,
      registryAddress,
      certIdToRevoke,
      executingAddress
    );

    if (!simResult.success) {
      setStep('error');
      setErrorType(simResult.errorType || 'SIMULATION_ERROR');
      setErrorMessage(simResult.errorReason || 'Smart contract simulation failed.');
      return;
    }

    // 2. Freeze parameters & save recovery draft in sessionStorage
    const draft: PendingRevocationDraft = {
      operationType: 'revocation',
      certId: certIdToRevoke,
      documentHash: docHashToRevoke,
      issuerAddress: executingAddress,
      chainId: targetChainId,
      registryAddress,
      stage: 'prepared',
      timestamp: Date.now(),
    };
    savePendingRevocation(draft);

    // 3. Prompt user wallet for signature & submission
    setStep('waiting_wallet');

    let submittedTxHash: Hex;
    try {
      submittedTxHash = await writeContractAsync({
        address: registryAddress,
        abi: CertProofRegistryABI,
        functionName: 'revokeCertificate',
        args: [certIdToRevoke],
      });
    } catch (err: unknown) {
      const errMessage = err instanceof Error ? err.message : String(err);
      console.warn('[REVOKE] Wallet submission rejected or failed:', err);

      // Clear draft on wallet rejection
      clearPendingRevocation();

      // Check if user rejected request in wallet
      if (
        errMessage.includes('User rejected') ||
        errMessage.includes('User denied') ||
        (err as { code?: number })?.code === 4001
      ) {
        setStep('confirm');
        setErrorMessage('Transaction request was rejected or cancelled in your wallet.');
        return;
      }

      setStep('error');
      setErrorType('WALLET_ERROR');
      setErrorMessage(errMessage || 'Wallet transaction failed.');
      return;
    }

    // 4. Update recovery draft with broadcasted txHash
    setTxHash(submittedTxHash);
    setStep('confirming');
    updatePendingRevocationTxHash(submittedTxHash);

    // 5. Wait for transaction receipt
    let receipt;
    try {
      receipt = await client.waitForTransactionReceipt({
        hash: submittedTxHash,
        timeout: 60_000,
      });
    } catch (err: unknown) {
      console.warn('[REVOKE] waitForTransactionReceipt timed out or failed:', err);
      // Do not broadcast again! Mark unknown receipt status.
      setStep('unknown_receipt');
      setErrorMessage(
        'Transaction was broadcast, but receipt confirmation timed out. Use "Check Transaction Status" to verify without rebroadcasting.'
      );
      return;
    }

    // 6. Verify Receipt and matching CertificateRevoked Event
    const verification = verifyCertificateRevokedReceipt(receipt, registryAddress, {
      certId: certIdToRevoke,
      issuer: executingAddress,
    });

    if (!verification.verified) {
      setStep('error');
      setErrorType('RECEIPT_VERIFICATION_FAILED');
      setErrorMessage(verification.error || 'Revocation receipt verification failed.');
      return;
    }

    // 7. Direct Contract Read Reconciliation
    try {
      const reconciled = await reconcileRevokedCertificate(
        client,
        registryAddress,
        certIdToRevoke
      );

      if (!reconciled.revoked) {
        setStep('error');
        setErrorType('RECONCILIATION_FAILED');
        setErrorMessage('Registry read indicates certificate was not revoked on-chain.');
        return;
      }

      // Check for stale account switch while transaction was confirming
      if (activeAddressRef.current?.toLowerCase() !== executingAddress.toLowerCase()) {
        clearPendingRevocation();
        return;
      }

      const authoritativeRevokedAt = verification.revokedAt || reconciled.revokedAt;
      setRevokedTimestamp(authoritativeRevokedAt);
      setStep('confirmed');
      clearPendingRevocation();
      onRevocationSuccess(certIdToRevoke, authoritativeRevokedAt);
    } catch (err: unknown) {
      setStep('error');
      setErrorType('RECONCILIATION_ERROR');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to reconcile authoritative certificate state from contract.'
      );
    }
  };

  if (!isOpen) return null;

  const isExecuting =
    step === 'simulating' ||
    step === 'waiting_wallet' ||
    step === 'broadcasting' ||
    step === 'confirming';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="revocation-modal-title"
      aria-describedby="revocation-modal-desc"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-xl shadow-2xl p-6 space-y-5"
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div>
            <h2 id="revocation-modal-title" className="text-lg font-bold text-white flex items-center gap-2">
              <span className="text-rose-500">⚠️</span> Permanent Certificate Revocation
            </h2>
            <p id="revocation-modal-desc" className="text-xs text-slate-400 mt-1">
              Revocation is an irreversible, permanent on-chain operation.
            </p>
          </div>
          {!isExecuting && (
            <button
              onClick={handleClose}
              className="text-slate-400 hover:text-white text-sm p-1 rounded hover:bg-slate-800 transition-colors"
              aria-label="Close dialog"
            >
              ✕
            </button>
          )}
        </div>

        {/* 1. CONFIRMATION & DETAILS STEP */}
        {(step === 'confirm' || isExecuting) && (
          <div className="space-y-4">
            {/* Target Certificate Identity Box */}
            <div className="p-3.5 bg-slate-950 border border-slate-800/80 rounded-lg space-y-2 text-xs font-mono">
              <div>
                <span className="text-slate-500 block text-[11px] font-sans">Certificate ID (certId):</span>
                <span className="text-indigo-300 break-all select-all">{certificate.certId}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[11px] font-sans">Document Keccak-256 Hash:</span>
                <span className="text-emerald-300 break-all select-all">{certificate.documentHash}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 border-t border-slate-800/60 font-sans text-[11px]">
                <div>
                  <span className="text-slate-500 block">Original Issuer:</span>
                  <span className="font-mono text-slate-300 truncate block" title={certificate.issuer}>
                    {certificate.issuer.slice(0, 10)}...{certificate.issuer.slice(-8)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Configured Chain:</span>
                  <span className="font-mono text-slate-300">
                    Chain ID {targetChainId} ({targetChainId === 31337 ? 'Local Anvil' : 'Sepolia'})
                  </span>
                </div>
              </div>
              <div className="pt-1 border-t border-slate-800/60 font-sans text-[11px]">
                <span className="text-slate-500 block">Registry Address:</span>
                <span className="font-mono text-slate-400 truncate block" title={registryAddress}>
                  {registryAddress}
                </span>
              </div>
            </div>

            {/* Educational Notices & Boundary Disclosures */}
            <div className="p-3.5 bg-rose-950/30 border border-rose-900/50 rounded-lg space-y-2 text-xs text-rose-200/90 leading-relaxed">
              <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                <span>⛔</span> Irreversible Blockchain Record Update
              </div>
              <ul className="list-disc pl-4 space-y-1 text-[11px]">
                <li>
                  <strong>Permanent:</strong> Once revoked on Ethereum, this certificate cannot be re-activated, reinstated, or re-registered with the same document hash.
                </li>
                <li>
                  <strong>Record update only:</strong> Revocation updates the registry record on-chain (<code className="text-rose-200">revoked = true</code> and records <code className="text-rose-200">revokedAt</code> timestamp). It does <strong>not</strong> delete the PDF document held by recipients, nor does it erase the registration timestamp or block history.
                </li>
                <li>
                  <strong>Zero-PDF Requirement:</strong> You do not need to re-upload the PDF file. Revocation targets the immutable on-chain certificate identifier.
                </li>
              </ul>
            </div>

            {/* Error or Rejection notice in confirm state */}
            {errorMessage && step === 'confirm' && (
              <div className="p-3 bg-amber-950/40 border border-amber-900/60 rounded-lg text-xs text-amber-200">
                <span className="font-semibold text-amber-300">Notice: </span>
                {errorMessage}
              </div>
            )}

            {/* In-Flight Status Indicator */}
            {isExecuting && (
              <div className="p-3 bg-indigo-950/40 border border-indigo-900/60 rounded-lg text-xs text-indigo-200 space-y-1 text-center">
                <div className="animate-spin inline-block text-lg">⚙️</div>
                <div className="font-semibold text-indigo-300">
                  {step === 'simulating' && 'Simulating Revocation on Contract...'}
                  {step === 'waiting_wallet' && 'Confirm Revocation in Wallet...'}
                  {step === 'broadcasting' && 'Broadcasting Transaction to Node...'}
                  {step === 'confirming' && 'Waiting for Blockchain Receipt & Event...'}
                </div>
                {txHash && (
                  <p className="font-mono text-[11px] text-indigo-400 truncate">
                    Tx: {txHash}
                  </p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                ref={cancelButtonRef}
                onClick={handleClose}
                disabled={isExecuting}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-slate-300 rounded-lg text-xs font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={executeRevocation}
                disabled={isExecuting}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 disabled:bg-rose-900 disabled:text-rose-400 text-white rounded-lg text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
              >
                {isExecuting ? 'Processing...' : 'Confirm Permanent Revocation'}
              </button>
            </div>
          </div>
        )}

        {/* 2. UNCERTAIN RECEIPT / TIMEOUT STATE */}
        {step === 'unknown_receipt' && (
          <div className="space-y-4">
            <div className="p-4 bg-amber-950/40 border border-amber-900/60 rounded-lg space-y-2 text-xs text-amber-200">
              <div className="font-bold text-amber-300 flex items-center gap-1.5">
                <span>⚠️</span> Transaction Receipt Pending
              </div>
              <p>
                Your revocation transaction was broadcast with hash:
              </p>
              <p className="font-mono text-[11px] text-amber-100 break-all bg-amber-900/30 p-2 rounded">
                {txHash}
              </p>
              <p className="text-[11px] text-amber-300/80 leading-relaxed">
                The transaction may still be in the node mempool or awaiting block confirmation. To prevent accidental duplicates, do not broadcast another transaction.
              </p>
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
              >
                Close & Check Later
              </button>
              {txHash && (
                <button
                  onClick={() => checkTransactionStatus(txHash)}
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                >
                  <span>🔄</span> Check Transaction Status
                </button>
              )}
            </div>
          </div>
        )}

        {/* 3. CONFIRMED REVOCATION STEP */}
        {step === 'confirmed' && (
          <div className="space-y-4">
            <div className="p-4 bg-emerald-950/40 border border-emerald-900/60 rounded-lg space-y-3 text-xs text-emerald-200">
              <div className="font-bold text-emerald-300 flex items-center gap-1.5 text-sm">
                <span>✓</span> Revocation Confirmed on Blockchain
              </div>
              <p className="leading-relaxed">
                Certificate record was permanently updated in the smart contract registry.
              </p>
              <div className="space-y-1.5 text-[11px] pt-1 border-t border-emerald-900/60 font-sans">
                <div>
                  <span className="text-emerald-400 font-semibold">Authoritative Revoked At: </span>
                  <span className="font-mono text-emerald-100">
                    {revokedTimestamp ? new Date(revokedTimestamp * 1000).toLocaleString() : 'Confirmed'}
                  </span>
                </div>
                {txHash && (
                  <div>
                    <span className="text-emerald-400 font-semibold">Transaction Hash: </span>
                    <span className="font-mono text-emerald-200 break-all select-all block">
                      {txHash}
                    </span>
                  </div>
                )}
              </div>
            </div>

            <p className="text-[11px] text-slate-400 leading-relaxed">
              The certificate remains visible in your certificate history marked as <strong>Revoked</strong> with its original registration timestamp and the authoritative revocation timestamp.
            </p>

            <div className="flex justify-end pt-2">
              <button
                onClick={handleClose}
                className="px-5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Close Dialog
              </button>
            </div>
          </div>
        )}

        {/* 4. ERROR STEP */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="p-4 bg-rose-950/40 border border-rose-900/60 rounded-lg space-y-2 text-xs text-rose-200">
              <div className="font-bold text-rose-300 flex items-center gap-1.5">
                <span>✕</span> Revocation Failed
              </div>
              <p className="leading-relaxed">{errorMessage}</p>
              {errorType && (
                <div className="text-[10px] text-rose-400/80 font-mono">
                  Error Code: {errorType}
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setStep('confirm');
                  setErrorMessage(null);
                  setErrorType(null);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-semibold transition-colors"
              >
                Try Again
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
