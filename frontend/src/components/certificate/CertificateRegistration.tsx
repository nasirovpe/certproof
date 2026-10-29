'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount, useChainId, useWriteContract, usePublicClient } from 'wagmi';
import { Hex, createPublicClient, http } from 'viem';
import { CertProofRegistryABI } from '@/lib/abi/CertProofRegistry';
import { anvilChain } from '@/lib/config/chains';
import { getClientEnv } from '@/lib/config/env';
import {
  computePdfKeccak256,
  MAX_PDF_SIZE_BYTES,
} from '@/lib/pdf/hash';
import {
  generateCertificateId,
  checkCertificateIdAvailable,
  simulateCertificateRegistration,
  verifyCertificateRegisteredReceipt,
} from '@/lib/certificate/registry';
import {
  savePendingRegistration,
  loadPendingRegistration,
  updatePendingRegistrationTxHash,
  clearPendingRegistration,
} from '@/lib/certificate/storage';
import { PendingRegistrationDraft } from '@/lib/certificate/types';

export type RegistrationStep =
  | 'idle'
  | 'hashing'
  | 'prepared'
  | 'simulating'
  | 'waiting_wallet'
  | 'broadcasting'
  | 'confirming'
  | 'confirmed'
  | 'unknown_receipt'
  | 'reselect_required'
  | 'error';

interface CertificateRegistrationProps {
  onRegistrationSuccess?: () => void;
}

export default function CertificateRegistration({
  onRegistrationSuccess,
}: CertificateRegistrationProps) {
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

  // Active public client helper
  const getActiveClient = useCallback(() => {
    if (wagmiPublicClientRef.current) return wagmiPublicClientRef.current;
    return createPublicClient({
      chain: anvilChain,
      transport: http(rpcUrl),
    });
  }, [rpcUrl]);

  // Component state
  const [step, setStep] = useState<RegistrationStep>('idle');
  const [fileInfo, setFileInfo] = useState<{ name: string; sizeBytes: number } | null>(null);
  const [documentHash, setDocumentHash] = useState<Hex | null>(null);
  const [certId, setCertId] = useState<Hex | null>(null);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [confirmedTimestamp, setConfirmedTimestamp] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorType, setErrorType] = useState<string | null>(null);

  // Draft recovery state (when pre-broadcast draft is restored without file bytes)
  const [recoveredDraft, setRecoveredDraft] = useState<PendingRegistrationDraft | null>(null);

  // File input ref for resetting
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  // Monotonically increasing ID to cancel stale hashing results
  const hashRequestIdRef = useRef<number>(0);
  // AbortController for in-flight hashing
  const hashAbortControllerRef = useRef<AbortController | null>(null);

  // Active address ref to prevent cross-account leaks
  const activeAddressRef = useRef<string | undefined>(address);
  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  const onRegistrationSuccessRef = useRef(onRegistrationSuccess);
  useEffect(() => {
    onRegistrationSuccessRef.current = onRegistrationSuccess;
  }, [onRegistrationSuccess]);

  // Reset state on account switch or disconnect
  const resetRegistrationState = useCallback(() => {
    if (hashAbortControllerRef.current) {
      hashAbortControllerRef.current.abort();
      hashAbortControllerRef.current = null;
    }
    setStep('idle');
    setFileInfo(null);
    setDocumentHash(null);
    setCertId(null);
    setTxHash(null);
    setConfirmedTimestamp(null);
    setErrorMessage(null);
    setErrorType(null);
    setRecoveredDraft(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  // 1. RECOVERY RECONCILIATION ON MOUNT OR SCOPE CHANGE
  useEffect(() => {
    if (!isConnected || !address || currentChainId !== targetChainId) {
      resetRegistrationState();
      return;
    }

    const draft = loadPendingRegistration({
      issuerAddress: address,
      chainId: targetChainId,
      registryAddress,
    });

    if (!draft) return;

    // A. Draft had broadcasted txHash: Reconcile with network!
    if (draft.txHash) {
      setCertId(draft.certId);
      setDocumentHash(draft.documentHash);
      setTxHash(draft.txHash);
      setStep('confirming');

      const client = getActiveClient();
      client
        .getTransactionReceipt({ hash: draft.txHash })
        .then((receipt) => {
          if (activeAddressRef.current?.toLowerCase() !== address.toLowerCase()) return;
          if (receipt) {
            const verification = verifyCertificateRegisteredReceipt(
              receipt,
              registryAddress,
              {
                certId: draft.certId,
                issuer: address as `0x${string}`,
                documentHash: draft.documentHash,
              }
            );

            if (verification.verified) {
              setStep('confirmed');
              setConfirmedTimestamp(verification.registeredAt || Math.floor(Date.now() / 1000));
              clearPendingRegistration();
              if (onRegistrationSuccessRef.current) onRegistrationSuccessRef.current();
            } else {
              setStep('error');
              setErrorMessage(verification.error || 'Receipt verification failed.');
              clearPendingRegistration();
            }
          }
        })
        .catch((err) => {
          if (activeAddressRef.current?.toLowerCase() !== address.toLowerCase()) return;
          // Network failure or still pending: Do not mark failed!
          setStep('unknown_receipt');
          setErrorMessage(
            `Unable to verify receipt for transaction ${draft.txHash}: ${
              err instanceof Error ? err.message : 'RPC query failed'
            }`
          );
        });
      return;
    }

    // B. Pre-broadcast draft: File bytes were never persisted in storage!
    // Prompt issuer to re-select the original PDF file to verify hash equivalence.
    setRecoveredDraft(draft);
    setCertId(draft.certId);
    setDocumentHash(draft.documentHash);
    setStep('reselect_required');
    // getActiveClient uses wagmiPublicClientRef to avoid infinite re-renders
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, isConnected, currentChainId, targetChainId, registryAddress, resetRegistrationState]);

  // 2. FILE SELECTION & IN-MEMORY HASHING
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const currentRequestId = ++hashRequestIdRef.current;

    // Abort any prior in-flight hashing
    if (hashAbortControllerRef.current) {
      hashAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    hashAbortControllerRef.current = abortController;

    setErrorMessage(null);
    setErrorType(null);
    setStep('hashing');

    // 1. Early file size check before reading
    if (file.size === 0) {
      setStep('error');
      setErrorMessage('The selected file is empty (0 bytes).');
      return;
    }
    if (file.size > MAX_PDF_SIZE_BYTES) {
      setStep('error');
      setErrorMessage(
        `File exceeds maximum permitted size of 32 MB (${(file.size / (1024 * 1024)).toFixed(
          2
        )} MB). Rejected prior to reading.`
      );
      return;
    }

    try {
      // 2. Raw In-Memory Keccak-256 computation & container heuristics
      const result = await computePdfKeccak256(file, {
        signal: abortController.signal,
      });

      // Discard stale result if another file was selected while hashing
      if (currentRequestId !== hashRequestIdRef.current) {
        return;
      }

      setFileInfo({
        name: file.name,
        sizeBytes: result.sizeBytes,
      });
      setDocumentHash(result.documentHash);

      // If restoring a pre-broadcast draft: Check if reselected file matches saved hash
      if (recoveredDraft) {
        if (result.documentHash.toLowerCase() !== recoveredDraft.documentHash.toLowerCase()) {
          setStep('error');
          setErrorType('HASH_MISMATCH');
          setErrorMessage(
            'The selected file does not match the pending draft document hash. Please select the matching document or discard the draft.'
          );
          return;
        }
        // Hash matches! Freeze recovered draft
        setCertId(recoveredDraft.certId);
        setStep('prepared');
        setRecoveredDraft(null);
        return;
      }

      // Generate a fresh, non-zero opaque 256-bit certId
      const newCertId = generateCertificateId();
      setCertId(newCertId);
      setStep('prepared');

      // Save prepared draft to sessionStorage (minimal metadata only, ZERO file bytes)
      if (address) {
        savePendingRegistration({
          certId: newCertId,
          documentHash: result.documentHash,
          issuerAddress: address as `0x${string}`,
          chainId: targetChainId,
          registryAddress,
          stage: 'prepared',
          timestamp: Date.now(),
        });
      }
    } catch (err: unknown) {
      if (currentRequestId !== hashRequestIdRef.current) return;
      if (err instanceof DOMException && err.name === 'AbortError') return;

      setStep('error');
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to process PDF file. Ensure it is an unaltered PDF container.'
      );
    }
  };

  // 3. BROADCAST REGISTRATION TRANSACTION
  const handleRegister = async () => {
    if (!address || !certId || !documentHash || !isConnected) return;
    if (currentChainId !== targetChainId) {
      setStep('error');
      setErrorMessage('Connected wallet is on an unsupported network. Please switch chains.');
      return;
    }

    setErrorMessage(null);
    setErrorType(null);
    setStep('simulating');

    const client = getActiveClient();

    let broadcastedTxHash: Hex | null = null;

    try {
      // Step A: Check ID availability
      const isIdAvailable = await checkCertificateIdAvailable(client, registryAddress, certId);
      if (!isIdAvailable) {
        // Regenerate opaque ID on collision
        const freshCertId = generateCertificateId();
        setCertId(freshCertId);
        savePendingRegistration({
          certId: freshCertId,
          documentHash,
          issuerAddress: address as `0x${string}`,
          chainId: targetChainId,
          registryAddress,
          stage: 'prepared',
          timestamp: Date.now(),
        });
      }

      const activeCertId = isIdAvailable ? certId : generateCertificateId();

      // Step B: Simulate contract call to enforce duplicate & auth rules
      const simulation = await simulateCertificateRegistration(
        client,
        registryAddress,
        activeCertId,
        documentHash,
        address as `0x${string}`
      );

      if (!simulation.success) {
        setStep('error');
        setErrorType(simulation.errorType || 'SIMULATION_ERROR');
        setErrorMessage(simulation.errorReason || 'Contract pre-flight check failed.');
        return;
      }

      // Step C: Prompt user wallet for signature
      setStep('waiting_wallet');

      const hash = await writeContractAsync({
        address: registryAddress,
        abi: CertProofRegistryABI,
        functionName: 'registerCertificate',
        args: [activeCertId, documentHash],
      });

      // Step D: Broadcasted! Update sessionStorage with txHash
      broadcastedTxHash = hash;
      setTxHash(hash);
      setStep('confirming');
      updatePendingRegistrationTxHash(hash);

      // Step E: Wait for receipt and verify event
      const receipt = await client.waitForTransactionReceipt({ hash });

      const verification = verifyCertificateRegisteredReceipt(receipt, registryAddress, {
        certId: activeCertId,
        issuer: address as `0x${string}`,
        documentHash,
      });

      if (verification.verified) {
        setStep('confirmed');
        setConfirmedTimestamp(verification.registeredAt || Math.floor(Date.now() / 1000));
        clearPendingRegistration();
        if (onRegistrationSuccessRef.current) onRegistrationSuccessRef.current();
      } else {
        setStep('error');
        setErrorMessage(
          verification.error ||
            'Transaction confirmed, but CertificateRegistered event could not be verified.'
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);

      // Distinguish user cancellation / rejection
      if (
        msg.includes('User rejected') ||
        msg.includes('User denied') ||
        msg.includes('rejected the request') ||
        msg.includes('4001')
      ) {
        setStep('prepared'); // Return to prepared state with frozen parameters
        setErrorMessage('Transaction was cancelled in your wallet. The document was not registered.');
        return;
      }

      // If tx was broadcasted but receipt polling timed out / network failed:
      if (broadcastedTxHash) {
        setStep('unknown_receipt');
        setErrorMessage(
          'Network timeout while waiting for transaction receipt. The transaction may still be confirming on-chain.'
        );
        return;
      }

      setStep('error');
      setErrorMessage(msg);
    }
  };

  // 4. CHECK EXISTING TRANSACTION (FOR UNCERTAIN RECEIPT STATUS)
  const handleCheckExistingTransaction = async () => {
    if (!txHash || !certId || !documentHash || !address) return;

    setErrorMessage(null);
    const client = getActiveClient();

    try {
      const receipt = await client.getTransactionReceipt({ hash: txHash });
      if (!receipt) {
        setErrorMessage('Transaction is still pending on-chain. Please wait a moment and retry.');
        return;
      }

      const verification = verifyCertificateRegisteredReceipt(receipt, registryAddress, {
        certId,
        issuer: address as `0x${string}`,
        documentHash,
      });

      if (verification.verified) {
        setStep('confirmed');
        setConfirmedTimestamp(verification.registeredAt || Math.floor(Date.now() / 1000));
        clearPendingRegistration();
        if (onRegistrationSuccess) onRegistrationSuccess();
      } else {
        setStep('error');
        setErrorMessage(verification.error || 'Receipt verification failed.');
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Failed to query transaction status from node.'
      );
    }
  };

  // Discard draft
  const handleDiscardDraft = () => {
    clearPendingRegistration();
    resetRegistrationState();
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 space-y-6">
      <div className="border-b border-slate-800 pb-4">
        <h2 className="text-lg font-semibold text-white">Register Certificate</h2>
        <p className="text-xs text-slate-400 mt-1">
          Compute document Keccak-256 fingerprint locally in browser memory and anchor to Ethereum.
        </p>
      </div>

      {/* DISCLOSURE & HEURISTICS NOTICE */}
      <div className="p-4 bg-slate-950/60 border border-slate-800 rounded-lg text-xs space-y-2 text-slate-400">
        <div className="flex items-center gap-2 text-indigo-400 font-semibold">
          <span>🛡️ Privacy & Verification Boundaries</span>
        </div>
        <p>
          <strong className="text-slate-300">Format Heuristics:</strong> CertProof enforces a 32 MB limit and verifies standard <code className="text-slate-200">%PDF-</code> and <code className="text-slate-200">%%EOF</code> container markers. These are format checks, not a full PDF structural validity or malware assessment.
        </p>
        <p>
          <strong className="text-slate-300">Zero Server Upload:</strong> PDF bytes, filenames, and contents are kept in browser memory only and never uploaded to any server, database, or blockchain.
        </p>
        <p>
          <strong className="text-slate-300">Legal Boundary:</strong> Registration records an immutable cryptographic document fingerprint and issuer wallet address on Ethereum. It does not establish academic accreditation, licensing validity, or document truth.
        </p>
      </div>

      {/* RECOVERY PROMPT (RESELECT REQUIRED FOR PRE-BROADCAST DRAFT) */}
      {step === 'reselect_required' && recoveredDraft && (
        <div className="bg-amber-950/40 border border-amber-900/60 rounded-xl p-5 space-y-3">
          <div className="text-amber-300 font-semibold text-sm">
            Pending Registration Draft Detected from Session
          </div>
          <p className="text-xs text-amber-200/90 leading-relaxed">
            A registration draft (<span className="font-mono text-amber-100">{recoveredDraft.certId}</span>) was restored from your session.
            Because PDF bytes are strictly memory-only and never saved to browser storage, please re-select the original PDF file to verify its fingerprint before broadcasting.
          </p>
          <div className="flex gap-3 pt-2">
            <button
              onClick={handleDiscardDraft}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs rounded transition-colors"
            >
              Discard Draft
            </button>
          </div>
        </div>
      )}

      {/* FILE SELECTION DROP ZONE */}
      {(step === 'idle' || step === 'hashing' || step === 'reselect_required' || (step === 'error' && !certId)) && (
        <div className="space-y-4">
          <label className="block text-xs font-medium text-slate-300">
            Select Credential PDF (Max 32 MB)
          </label>
          <div className="border-2 border-dashed border-slate-700 hover:border-indigo-500/70 rounded-xl p-8 text-center bg-slate-950/40 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              onChange={handleFileSelect}
              disabled={step === 'hashing'}
              className="hidden"
              id="certificate-file-input"
            />
            <label
              htmlFor="certificate-file-input"
              className="cursor-pointer flex flex-col items-center justify-center space-y-3"
            >
              <div className="w-12 h-12 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center text-2xl font-bold">
                📄
              </div>
              <div className="text-sm font-medium text-slate-200">
                {step === 'hashing' ? (
                  <span className="text-indigo-400 animate-pulse">
                    Computing Keccak-256 Digest in Memory...
                  </span>
                ) : (
                  <span>Click to choose PDF or drag and drop</span>
                )}
              </div>
              <p className="text-xs text-slate-500">
                Unaltered binary ingestion • Maximum file size 32 MB
              </p>
            </label>
          </div>
        </div>
      )}

      {/* FROZEN REGISTRATION SUMMARY (PREPARED OR IN PROGRESS) */}
      {(step === 'prepared' ||
        step === 'simulating' ||
        step === 'waiting_wallet' ||
        step === 'broadcasting' ||
        step === 'confirming' ||
        step === 'unknown_receipt' ||
        (step === 'error' && certId)) && (
        <div className="space-y-5">
          <div className="bg-slate-950 border border-slate-800 rounded-lg p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800/80 pb-3">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Frozen Registration Summary
              </span>
              {fileInfo && (
                <span className="text-xs text-slate-400 font-mono">
                  {fileInfo.name} ({(fileInfo.sizeBytes / 1024).toFixed(1)} KB)
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 gap-3 text-xs">
              <div>
                <span className="text-slate-500 block">Certificate ID (Opaque bytes32):</span>
                <span className="text-indigo-300 font-mono break-all">{certId}</span>
              </div>
              <div>
                <span className="text-slate-500 block">Document Hash (Keccak-256):</span>
                <span className="text-emerald-300 font-mono break-all">{documentHash}</span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  Any byte change in this PDF will yield a completely different hash.
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1 border-t border-slate-800/60">
                <div>
                  <span className="text-slate-500 block">Issuing Account:</span>
                  <span className="text-slate-300 font-mono break-all">{address}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Target Registry:</span>
                  <span className="text-slate-300 font-mono break-all">{registryAddress}</span>
                </div>
              </div>
            </div>
          </div>

          {/* TX STATUS TRACKER */}
          {step === 'simulating' && (
            <div className="p-3 bg-indigo-950/30 border border-indigo-900/40 rounded text-xs text-indigo-300 flex items-center gap-2">
              <span className="animate-spin">⏳</span> Simulating registration against smart contract...
            </div>
          )}

          {step === 'waiting_wallet' && (
            <div className="p-3 bg-amber-950/30 border border-amber-900/40 rounded text-xs text-amber-300 flex items-center gap-2">
              <span className="animate-pulse">✍️</span> Please confirm the transaction in your wallet extension...
            </div>
          )}

          {step === 'confirming' && (
            <div className="p-3 bg-indigo-950/40 border border-indigo-900/50 rounded text-xs text-indigo-300 space-y-1">
              <div className="flex items-center gap-2 font-semibold">
                <span className="animate-spin">⛓️</span> Transaction Broadcasted — Awaiting Block Confirmation
              </div>
              {txHash && (
                <p className="font-mono text-[11px] text-indigo-200 break-all">Tx Hash: {txHash}</p>
              )}
            </div>
          )}

          {/* UNKNOWN RECEIPT STATUS WARNING */}
          {step === 'unknown_receipt' && (
            <div className="p-4 bg-amber-950/40 border border-amber-900/60 rounded-lg text-xs text-amber-200 space-y-3">
              <div className="font-semibold text-amber-300 flex items-center gap-2">
                <span>⚠️ Uncertain Transaction Receipt Status</span>
              </div>
              <p>
                Receipt confirmation timed out or encountered an RPC transport error. The transaction (<span className="font-mono">{txHash}</span>) may still be confirming on Ethereum.
              </p>
              <p className="font-semibold text-amber-100">
                Do NOT submit a duplicate registration transaction. Verify the existing transaction status below.
              </p>
              <button
                onClick={handleCheckExistingTransaction}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded text-xs transition-colors"
              >
                Check Existing Transaction Status
              </button>
            </div>
          )}

          {/* ACTION BUTTONS */}
          {step === 'prepared' && (
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleRegister}
                className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-sm rounded-lg shadow transition-colors flex items-center gap-2"
              >
                <span>Confirm & Register on Blockchain</span>
              </button>
              <button
                onClick={handleDiscardDraft}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors"
              >
                Select Different File
              </button>
            </div>
          )}
        </div>
      )}

      {/* CONFIRMED SUCCESS STATE */}
      {step === 'confirmed' && (
        <div className="bg-emerald-950/40 border border-emerald-900/60 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-emerald-300 font-bold text-base">
            <span>✅ Certificate Successfully Registered</span>
          </div>
          <p className="text-xs text-emerald-200/90 leading-relaxed">
            The document fingerprint was verified and anchored to Ethereum via <span className="font-mono">CertificateRegistered</span> event log.
          </p>

          <div className="bg-slate-950/80 border border-emerald-950 rounded-lg p-4 text-xs font-mono space-y-2">
            <div>
              <span className="text-slate-500">Certificate ID: </span>
              <span className="text-indigo-300 break-all">{certId}</span>
            </div>
            <div>
              <span className="text-slate-500">Document Hash: </span>
              <span className="text-emerald-300 break-all">{documentHash}</span>
            </div>
            {confirmedTimestamp && (
              <div>
                <span className="text-slate-500">Registered At: </span>
                <span className="text-slate-300">
                  {new Date(confirmedTimestamp * 1000).toLocaleString()}
                </span>
              </div>
            )}
            {txHash && (
              <div>
                <span className="text-slate-500">Transaction: </span>
                <span className="text-slate-300 break-all">{txHash}</span>
              </div>
            )}
          </div>

          <button
            onClick={resetRegistrationState}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium rounded-lg transition-colors"
          >
            Register Another Certificate
          </button>
        </div>
      )}

      {/* ERROR BANNER */}
      {errorMessage && (
        <div className="bg-rose-950/40 border border-rose-900/60 rounded-lg p-4 text-xs text-rose-200 space-y-1">
          <div className="font-semibold text-rose-300">
            {errorType === 'ALREADY_REGISTERED'
              ? 'Duplicate Registration Prohibited'
              : errorType === 'UNAUTHORIZED_ISSUER'
              ? 'Unauthorized Issuer'
              : 'Registration Error'}
          </div>
          <p>{errorMessage}</p>
        </div>
      )}
    </div>
  );
}
