'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import { createPublicClient, http, Hex, Address } from 'viem';
import { sepolia } from 'viem/chains';
import { anvilChain } from '@/lib/config/chains';
import { getClientEnv } from '@/lib/config/env';
import {
  fetchPublicCertificate,
  PublicCertificateReadResult,
  CandidateFileComparison,
} from '@/lib/certificate/registry';
import {
  computePdfKeccak256,
  MAX_PDF_SIZE_BYTES,
} from '@/lib/pdf/hash';
import { CopyButton } from '@/components/common/CopyButton';
import { CertificateShareControls } from '@/components/certificate/CertificateShareControls';
import {
  ShieldCheck,
  ShieldAlert,
  FileCheck2,
  FileX2,
  FileQuestion,
  RefreshCw,
  AlertTriangle,
  ExternalLink,
  Upload,
  XCircle,
  Clock,
  Building2,
  Binary,
  Layers,
  DatabaseZap,
} from 'lucide-react';

interface PublicCertificateVerifierProps {
  certId: string;
  initialSearchParams?: {
    chainId?: string;
    registry?: string;
    [key: string]: string | undefined;
  };
}

export function PublicCertificateVerifier({
  certId,
  initialSearchParams,
}: PublicCertificateVerifierProps) {
  const clientEnv = getClientEnv();
  const targetChainId = clientEnv.NEXT_PUBLIC_CHAIN_ID;
  const configuredRegistryAddress = clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS;

  const targetChain = targetChainId === 11155111 ? sepolia : anvilChain;
  const rpcUrl =
    targetChainId === 11155111
      ? clientEnv.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org'
      : clientEnv.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545';

  // Contract read state
  const [readResult, setReadResult] = useState<PublicCertificateReadResult | null>(null);
  const [readLoading, setReadLoading] = useState<boolean>(true);
  const readRequestIdRef = useRef<number>(0);

  // File comparison state
  const [comparison, setComparison] = useState<CandidateFileComparison>({
    status: 'UNCHECKED_NO_FILE',
  });
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const hashRequestIdRef = useRef<number>(0);
  const hashAbortControllerRef = useRef<AbortController | null>(null);

  // Perform authoritative contract read
  const loadCertificate = useCallback(async () => {
    const reqId = ++readRequestIdRef.current;
    setReadLoading(true);

    const publicClient = createPublicClient({
      chain: targetChain,
      transport: http(rpcUrl, { timeout: 8000 }),
    });

    const requestedChainId = initialSearchParams?.chainId
      ? Number(initialSearchParams.chainId)
      : undefined;
    const requestedRegistry = initialSearchParams?.registry;

    try {
      const result = await fetchPublicCertificate(
        publicClient,
        configuredRegistryAddress,
        certId,
        {
          expectedChainId: targetChainId,
          requestedChainId,
          requestedRegistry,
        }
      );

      if (reqId === readRequestIdRef.current) {
        setReadResult(result);
        setReadLoading(false);
      }
    } catch (err: unknown) {
      if (reqId === readRequestIdRef.current) {
        setReadResult({
          status: 'RPC_ERROR',
          chainId: targetChainId,
          registryAddress: configuredRegistryAddress,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
        setReadLoading(false);
      }
    }
  }, [
    targetChain,
    rpcUrl,
    configuredRegistryAddress,
    certId,
    targetChainId,
    initialSearchParams?.chainId,
    initialSearchParams?.registry,
  ]);

  // Initial fetch and fetch on certId changes
  useEffect(() => {
    // Reset candidate file comparison immediately on certificate change
    if (hashAbortControllerRef.current) {
      hashAbortControllerRef.current.abort();
      hashAbortControllerRef.current = null;
    }
    setComparison({ status: 'UNCHECKED_NO_FILE' });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }

    loadCertificate();

    return () => {
      if (hashAbortControllerRef.current) {
        hashAbortControllerRef.current.abort();
        hashAbortControllerRef.current = null;
      }
    };
  }, [certId, loadCertificate]);

  // Handle Candidate File Processing
  const handleFileProcess = async (file: File) => {
    if (!readResult || readResult.status !== 'REGISTERED' || !readResult.record) {
      return;
    }

    const currentHashReqId = ++hashRequestIdRef.current;

    // Abort any prior in-flight calculation
    if (hashAbortControllerRef.current) {
      hashAbortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    hashAbortControllerRef.current = abortController;

    setComparison({
      status: 'HASHING',
      fileName: file.name,
      fileSizeBytes: file.size,
    });

    // 1. Early rejection before reading into memory
    if (file.size === 0) {
      setComparison({
        status: 'FILE_ERROR',
        fileName: file.name,
        fileSizeBytes: 0,
        errorMessage: 'The selected file is empty (0 bytes).',
      });
      return;
    }

    if (file.size > MAX_PDF_SIZE_BYTES) {
      setComparison({
        status: 'FILE_ERROR',
        fileName: file.name,
        fileSizeBytes: file.size,
        errorMessage: `File exceeds maximum permitted size of 32 MB (${(file.size / (1024 * 1024)).toFixed(2)} MB). Rejected prior to reading.`,
      });
      return;
    }

    try {
      // 2. Client-side Keccak-256 via Web Worker (or direct fallback in tests)
      const hashResult = await computePdfKeccak256(file, {
        signal: abortController.signal,
      });

      if (currentHashReqId !== hashRequestIdRef.current) {
        return;
      }

      const registeredHash = readResult.record.documentHash.toLowerCase();
      const candidateHash = hashResult.documentHash.toLowerCase();
      const isMatch = registeredHash === candidateHash;

      setComparison({
        status: isMatch ? 'MATCHING' : 'MISMATCHING',
        localHash: hashResult.documentHash,
        fileName: file.name,
        fileSizeBytes: hashResult.sizeBytes,
      });
    } catch (err: unknown) {
      if (currentHashReqId !== hashRequestIdRef.current) {
        return;
      }
      if (
        (err instanceof DOMException && err.name === 'AbortError') ||
        (err instanceof Error && err.name === 'AbortError')
      ) {
        return;
      }

      setComparison({
        status: 'FILE_ERROR',
        fileName: file.name,
        fileSizeBytes: file.size,
        errorMessage: err instanceof Error ? err.message : 'Failed to compute document hash.',
      });
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileProcess(files[0]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      handleFileProcess(files[0]);
    }
  };

  const handleClearFile = () => {
    if (hashAbortControllerRef.current) {
      hashAbortControllerRef.current.abort();
      hashAbortControllerRef.current = null;
    }
    setComparison({ status: 'UNCHECKED_NO_FILE' });
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Helper date formatter
  const formatTimestamp = (sec: number) => {
    if (!sec || sec === 0) return 'N/A';
    const date = new Date(sec * 1000);
    return `${date.toUTCString()} (${sec})`;
  };

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 space-y-8">
      {/* 1. PUBLIC VERIFICATION HEADER */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="space-y-1">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Public Verification Route</span>
              <span className="w-1 h-1 rounded-full bg-indigo-400" />
              <span>Zero-Auth Direct Contract Inspection</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Public Certificate Verification
            </h1>
          </div>

          <button
            type="button"
            onClick={loadCertificate}
            disabled={readLoading}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${readLoading ? 'animate-spin' : ''}`} />
            <span>{readLoading ? 'Querying Blockchain...' : 'Refresh On-Chain Record'}</span>
          </button>
        </div>

        {/* DEPLOYMENT SCOPE BAR */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs bg-slate-950/60 border border-slate-800/80 rounded-xl p-4">
          <div>
            <span className="text-slate-400 block mb-0.5 font-medium">Target Network:</span>
            <span className="font-semibold text-slate-200">
              {targetChainId === 31337 ? 'Local Anvil (Chain ID 31337)' : 'Ethereum Sepolia (Chain ID 11155111)'}
            </span>
          </div>

          <div>
            <span className="text-slate-400 block mb-0.5 font-medium">Registry Contract:</span>
            <div className="flex items-center gap-1.5 font-mono text-slate-300">
              <span className="truncate">{configuredRegistryAddress}</span>
              <CopyButton text={configuredRegistryAddress} label="Copy registry address" />
            </div>
          </div>

          <div>
            <span className="text-slate-400 block mb-0.5 font-medium">Observed Snapshot:</span>
            <span className="font-semibold text-slate-200">
              {readResult?.blockNumber !== undefined ? `Block #${readResult.blockNumber.toString()}` : 'Pending query...'}
            </span>
          </div>
        </div>
      </div>

      {/* 2. LOADING STATE */}
      {readLoading && !readResult && (
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-12 text-center space-y-4">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
          <div className="text-slate-300 font-medium">Querying authoritative Ethereum state...</div>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Reading certificate record directly from smart contract without relying on off-chain databases or indexers.
          </p>
        </div>
      )}

      {/* 3. ERROR & EDGE STATES (RPC, MALFORMED, UNSUPPORTED, MISSING DEPLOYMENT) */}
      {!readLoading && readResult?.status === 'MALFORMED_ID' && (
        <div className="bg-rose-950/40 border border-rose-900/60 rounded-2xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-3 text-rose-400">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <h2 className="text-lg font-bold">Malformed Certificate ID</h2>
          </div>
          <p className="text-sm text-rose-200/90 leading-relaxed">
            The provided identifier (<code className="bg-rose-900/40 px-1.5 py-0.5 rounded text-rose-100 font-mono text-xs break-all">{certId}</code>) is not a valid 32-byte hexadecimal certificate ID.
          </p>
          <div className="text-xs text-rose-300/80 bg-rose-950/60 p-4 rounded-xl border border-rose-900/40 space-y-1">
            <p><strong>Requirement:</strong> Certificate identifiers must be non-zero 66-character hexadecimal strings starting with <code className="text-rose-200">0x</code>.</p>
            <p>No Ethereum RPC requests were dispatched for this malformed input.</p>
          </div>
        </div>
      )}

      {!readLoading && readResult?.status === 'UNSUPPORTED_DEPLOYMENT' && (
        <div className="bg-amber-950/40 border border-amber-900/60 rounded-2xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-3 text-amber-400">
            <AlertTriangle className="w-6 h-6 shrink-0" />
            <h2 className="text-lg font-bold">Unsupported Deployment Configuration</h2>
          </div>
          <p className="text-sm text-amber-200/90 leading-relaxed">
            {readResult.errorMessage || 'The requested deployment parameters do not match this verifier.'}
          </p>
          <p className="text-xs text-amber-300/80">
            This verifier strictly inspects the configured deployment (Chain ID {targetChainId}, Registry {configuredRegistryAddress}) to prevent cross-network ambiguity or RPC tampering.
          </p>
        </div>
      )}

      {!readLoading && readResult?.status === 'MISSING_DEPLOYMENT' && (
        <div className="bg-amber-950/40 border border-amber-900/60 rounded-2xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-3 text-amber-400">
            <Layers className="w-6 h-6 shrink-0" />
            <h2 className="text-lg font-bold">Missing Contract Deployment</h2>
          </div>
          <p className="text-sm text-amber-200/90 leading-relaxed">
            No smart contract bytecode exists at the configured registry address (<code className="font-mono text-xs">{configuredRegistryAddress}</code>) on Chain ID {targetChainId}.
          </p>
          <p className="text-xs text-amber-300/80">
            Ensure local Anvil node is active and the registry contract has been deployed.
          </p>
          <button
            type="button"
            onClick={loadCertificate}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl shadow transition-colors"
          >
            Retry Query
          </button>
        </div>
      )}

      {!readLoading && readResult?.status === 'RPC_ERROR' && (
        <div className="bg-amber-950/40 border border-amber-900/60 rounded-2xl p-6 sm:p-8 space-y-4">
          <div className="flex items-center gap-3 text-amber-400">
            <DatabaseZap className="w-6 h-6 shrink-0" />
            <h2 className="text-lg font-bold">Ethereum RPC Communication Failure</h2>
          </div>
          <p className="text-sm text-amber-200/90 leading-relaxed">
            {readResult.errorMessage || 'Unable to connect to the configured Ethereum RPC node.'}
          </p>
          <div className="bg-amber-950/60 border border-amber-900/40 rounded-xl p-4 text-xs text-amber-300 space-y-1">
            <p className="font-semibold text-amber-200">Authoritative Integrity Guarantee:</p>
            <p>
              An RPC transport outage or timeout is <strong>never mapped</strong> to “unregistered,” “not revoked,” or “authorized.” Please check your network connection or retry the query.
            </p>
          </div>
          <button
            type="button"
            onClick={loadCertificate}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs rounded-xl shadow transition-colors"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* 4. UNREGISTERED CERTIFICATE STATE */}
      {!readLoading && readResult?.status === 'UNREGISTERED' && (
        <div className="space-y-6">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                  <FileQuestion className="w-3.5 h-3.5 text-slate-400" />
                  <span>On-Chain Record: UNREGISTERED</span>
                </div>
                <h2 className="text-xl font-bold text-white">Certificate Not Found</h2>
              </div>
            </div>

            <p className="text-sm text-slate-300 leading-relaxed">
              No registration record exists for Certificate ID <code className="font-mono text-xs text-indigo-300">{readResult.certId}</code> in the authoritative registry contract at block #{readResult.blockNumber?.toString()}.
            </p>

            <div className="p-4 bg-slate-950/70 border border-slate-800 rounded-xl text-xs space-y-2 text-slate-400">
              <p>
                <strong>Notice:</strong> Document comparison cannot proceed because there is no registered document hash to compare candidate files against.
              </p>
              <p>
                Please verify that you have copied the complete, correct 66-character verification link.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 5. REGISTERED CERTIFICATE: 4 INDEPENDENT VERIFICATION FACTS */}
      {!readLoading && readResult?.status === 'REGISTERED' && readResult.record && (
        <div className="space-y-8">
          {/* NOTICE: INDEPENDENT FACTS BANNER */}
          <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-4 text-xs text-slate-400 space-y-1">
            <div className="flex items-center gap-2 font-semibold text-slate-200">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>Independent Verification Model</span>
            </div>
            <p>
              CertProof presents registration existence, candidate file match, certificate revocation, and current issuer authorization as four independent dimensions. They are not collapsed into a single summary badge.
            </p>
          </div>

          {/* GRID OF THE 4 INDEPENDENT FACTS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* FACT 1: ON-CHAIN REGISTRATION RECORD */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-sm">
                    1
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Registration Record</h3>
                    <p className="text-xs text-slate-400">Immutable blockchain anchor</p>
                  </div>
                </div>

                <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  Registered
                </span>
              </div>

              <div className="space-y-4 text-xs">
                <div>
                  <span className="text-slate-400 block mb-1 font-medium">Certificate ID (certId):</span>
                  <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5 font-mono text-slate-200 break-all">
                    <span>{readResult.record.certId}</span>
                    <CopyButton text={readResult.record.certId} label="Copy Certificate ID" />
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 block mb-1 font-medium">Registered Document Hash (Keccak-256):</span>
                  <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5 font-mono text-slate-200 break-all">
                    <span>{readResult.record.documentHash}</span>
                    <CopyButton text={readResult.record.documentHash} label="Copy Document Hash" />
                  </div>
                </div>

                <div>
                  <span className="text-slate-400 block mb-1 font-medium">Original Issuing Wallet:</span>
                  <div className="flex items-center justify-between bg-slate-950/70 border border-slate-800/80 rounded-lg p-2.5 font-mono text-slate-200 break-all">
                    <span>{readResult.record.issuer}</span>
                    <CopyButton text={readResult.record.issuer} label="Copy Issuer Address" />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div className="bg-slate-950/50 border border-slate-800/60 rounded-lg p-2.5">
                    <span className="text-slate-400 block mb-0.5 font-medium">Registration Time:</span>
                    <span className="text-slate-200 font-semibold">{formatTimestamp(readResult.record.registeredAt)}</span>
                  </div>

                  <div className="bg-slate-950/50 border border-slate-800/60 rounded-lg p-2.5">
                    <span className="text-slate-400 block mb-0.5 font-medium">Observed Snapshot:</span>
                    <span className="text-slate-200 font-semibold">Block #{readResult.blockNumber?.toString()}</span>
                  </div>
                </div>

                <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
                  <span className="text-slate-400 font-medium">Share & Verification QR:</span>
                  <CertificateShareControls
                    certId={readResult.record.certId}
                    chainId={targetChainId}
                    registryAddress={configuredRegistryAddress}
                    isRevoked={readResult.record.revoked}
                    isIssuerAuthorized={readResult.isIssuerCurrentlyAuthorized}
                  />
                </div>
              </div>
            </div>

            {/* FACT 2: CANDIDATE FILE COMPARISON */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm">
                    2
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Candidate Document Comparison</h3>
                    <p className="text-xs text-slate-400">Browser-local byte Keccak-256 evaluation</p>
                  </div>
                </div>

                {comparison.status === 'UNCHECKED_NO_FILE' && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Unchecked (No File)
                  </span>
                )}
                {comparison.status === 'HASHING' && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 animate-pulse">
                    Computing Hash...
                  </span>
                )}
                {comparison.status === 'MATCHING' && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Byte-for-Byte Match
                  </span>
                )}
                {comparison.status === 'MISMATCHING' && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    Hash Mismatch
                  </span>
                )}
                {comparison.status === 'FILE_ERROR' && (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    File Error
                  </span>
                )}
              </div>

              {/* CANDIDATE STATUS CALLOUTS */}
              {comparison.status === 'UNCHECKED_NO_FILE' && (
                <div className="p-4 bg-amber-950/30 border border-amber-900/50 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-amber-400 font-bold">
                    <FileQuestion className="w-4 h-4 shrink-0" />
                    <span>DOCUMENT HAS NOT BEEN COMPARED</span>
                  </div>
                  <p className="text-amber-200/90 leading-relaxed">
                    Opening this link displays on-chain registry metadata only. It does <strong>not</strong> verify that any physical or digital document in your possession matches this record.
                  </p>
                  <p className="text-amber-300/80">
                    Select or drag-and-drop the candidate PDF below to compute its raw Keccak-256 fingerprint in browser memory.
                  </p>
                </div>
              )}

              {comparison.status === 'HASHING' && (
                <div className="p-4 bg-indigo-950/30 border border-indigo-900/50 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-indigo-400 font-semibold">
                    <RefreshCw className="w-4 h-4 animate-spin shrink-0" />
                    <span>Computing Keccak-256 in Browser Memory...</span>
                  </div>
                  <p className="text-slate-300">
                    Evaluating binary byte stream inside a dedicated background Web Worker without blocking the UI.
                  </p>
                </div>
              )}

              {comparison.status === 'MATCHING' && (
                <div className="p-4 bg-emerald-950/30 border border-emerald-900/50 rounded-xl space-y-3 text-xs">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <FileCheck2 className="w-5 h-5 shrink-0" />
                    <span>BYTE-FOR-BYTE IDENTICAL</span>
                  </div>
                  <p className="text-emerald-200/90 leading-relaxed">
                    The selected file&apos;s Keccak-256 digest exactly matches the on-chain registered document hash.
                  </p>
                  <div className="space-y-1.5 font-mono text-[11px] bg-slate-950/70 p-3 rounded-lg border border-emerald-900/30">
                    <div className="flex items-center justify-between text-slate-300 break-all">
                      <span>Candidate Hash: {comparison.localHash}</span>
                      {comparison.localHash && <CopyButton text={comparison.localHash} label="Copy candidate hash" />}
                    </div>
                    <div className="text-emerald-400 break-all">
                      Registered Hash: {readResult.record.documentHash}
                    </div>
                  </div>
                </div>
              )}

              {comparison.status === 'MISMATCHING' && (
                <div className="p-4 bg-rose-950/30 border border-rose-900/50 rounded-xl space-y-3 text-xs">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                    <FileX2 className="w-5 h-5 shrink-0" />
                    <span>DOCUMENT HASH MISMATCH</span>
                  </div>
                  <p className="text-rose-200/90 leading-relaxed">
                    The selected file does <strong>not</strong> match the on-chain registered document hash. The document may have been altered, re-saved, compressed, or is a different file.
                  </p>
                  <div className="space-y-1.5 font-mono text-[11px] bg-slate-950/70 p-3 rounded-lg border border-rose-900/30">
                    <div className="flex items-center justify-between text-rose-300 break-all">
                      <span>Candidate Hash: {comparison.localHash}</span>
                      {comparison.localHash && <CopyButton text={comparison.localHash} label="Copy candidate hash" />}
                    </div>
                    <div className="text-slate-400 break-all">
                      Registered Hash: {readResult.record.documentHash}
                    </div>
                  </div>
                </div>
              )}

              {comparison.status === 'FILE_ERROR' && (
                <div className="p-4 bg-rose-950/30 border border-rose-900/50 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-rose-400 font-bold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>File Processing Error</span>
                  </div>
                  <p className="text-rose-200/90 leading-relaxed">
                    {comparison.errorMessage || 'Invalid file format or reading error.'}
                  </p>
                </div>
              )}

              {/* DROP ZONE */}
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${
                  isDragging
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-slate-800 bg-slate-950/40 hover:border-slate-700'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  onChange={handleFileInputChange}
                  className="hidden"
                  id="verifier-pdf-input"
                />

                <div className="space-y-3">
                  <Upload className="w-6 h-6 text-slate-400 mx-auto" />
                  <div className="text-xs text-slate-300">
                    <label
                      htmlFor="verifier-pdf-input"
                      className="cursor-pointer text-indigo-400 hover:text-indigo-300 font-semibold underline underline-offset-2"
                    >
                      Choose PDF
                    </label>{' '}
                    or drag & drop candidate file here
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Max 32 MB • Container heuristics (%PDF- and %%EOF) enforced • Zero server upload
                  </p>
                </div>
              </div>

              {comparison.status !== 'UNCHECKED_NO_FILE' && (
                <div className="flex items-center justify-between text-xs pt-1">
                  <span className="text-slate-400 truncate max-w-xs">
                    File: <strong className="text-slate-200">{comparison.fileName}</strong>{' '}
                    {comparison.fileSizeBytes !== undefined && `(${(comparison.fileSizeBytes / 1024).toFixed(1)} KB)`}
                  </span>
                  <button
                    type="button"
                    onClick={handleClearFile}
                    className="inline-flex items-center gap-1 text-slate-400 hover:text-rose-400 transition-colors"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    <span>Clear File</span>
                  </button>
                </div>
              )}

              {/* BOUNDARY DISCLOSURE */}
              <div className="p-3 bg-slate-950/40 border border-slate-800/80 rounded-lg text-[11px] text-slate-400 space-y-1">
                <p>
                  <strong>Cryptographic Boundary:</strong> A hash match confirms byte equality with the registered fingerprint, not accreditation, issuer identity verification, or truth of the document&apos;s claims.
                </p>
                <p>
                  <strong>Zero-Upload Privacy:</strong> Bytes remain in browser memory only. They are never uploaded, logged, or transmitted.
                </p>
              </div>
            </div>

            {/* FACT 3: CERTIFICATE REVOCATION */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm">
                    3
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Certificate Revocation</h3>
                    <p className="text-xs text-slate-400">Original issuer revocation status</p>
                  </div>
                </div>

                {readResult.record.revoked ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                    Revoked
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Active (Not Revoked)
                  </span>
                )}
              </div>

              {readResult.record.revoked ? (
                <div className="p-4 bg-rose-950/30 border border-rose-900/50 rounded-xl space-y-3 text-xs">
                  <div className="flex items-center gap-2 text-rose-400 font-bold text-sm">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span>CERTIFICATE PERMANENTLY REVOKED</span>
                  </div>
                  <p className="text-rose-200/90 leading-relaxed">
                    This certificate was permanently invalidated on Ethereum by its original issuing wallet.
                  </p>
                  <div className="bg-slate-950/70 p-3 rounded-lg border border-rose-900/30 text-slate-300 space-y-1">
                    <div>
                      <span className="text-slate-400">Authoritative Revocation Timestamp:</span>{' '}
                      <strong className="text-rose-300 font-mono">{formatTimestamp(readResult.record.revokedAt)}</strong>
                    </div>
                  </div>
                  <p className="text-rose-300/80 text-[11px]">
                    <strong>Important:</strong> Even if a candidate PDF matches the registered document hash, this credential has been permanently revoked by the issuing institution.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-emerald-950/30 border border-emerald-900/50 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <ShieldCheck className="w-4 h-4 shrink-0" />
                    <span>No Revocation Recorded</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    The original issuing wallet has not submitted a revocation transaction for this certificate ID.
                  </p>
                </div>
              )}
            </div>

            {/* FACT 4: CURRENT ISSUER AUTHORIZATION */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-5">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm">
                    4
                  </div>
                  <div>
                    <h3 className="font-bold text-white text-base">Current Issuer Authorization</h3>
                    <p className="text-xs text-slate-400">Registry administrator permission</p>
                  </div>
                </div>

                {readResult.isIssuerCurrentlyAuthorized ? (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Currently Authorized
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Currently Deauthorized
                  </span>
                )}
              </div>

              {readResult.isIssuerCurrentlyAuthorized ? (
                <div className="p-4 bg-emerald-950/30 border border-emerald-900/50 rounded-xl space-y-2 text-xs">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold">
                    <Building2 className="w-4 h-4 shrink-0" />
                    <span>Issuing Address is Currently Authorized</span>
                  </div>
                  <p className="text-slate-300 leading-relaxed">
                    The original issuing wallet (<code className="font-mono text-[11px] text-slate-200 break-all">{readResult.record.issuer}</code>) is currently recognized as an authorized issuer by the registry administrator.
                  </p>
                </div>
              ) : (
                <div className="p-4 bg-amber-950/30 border border-amber-900/50 rounded-xl space-y-3 text-xs">
                  <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                    <AlertTriangle className="w-5 h-5 shrink-0" />
                    <span>ISSUING WALLET DEAUTHORIZED</span>
                  </div>
                  <p className="text-amber-200/90 leading-relaxed">
                    The issuing wallet address (<code className="font-mono text-[11px] text-amber-100 break-all">{readResult.record.issuer}</code>) is not currently an authorized issuer in the smart contract registry.
                  </p>
                  <p className="text-amber-300/80 text-[11px]">
                    The administrator removed issuance rights for this address. Note that deauthorization does not rewrite past registration history.
                  </p>
                </div>
              )}

              <div className="p-3 bg-slate-950/40 border border-slate-800/80 rounded-lg text-[11px] text-slate-400">
                <strong className="text-slate-300">Authorization Scope:</strong> Current issuer authorization answers whether this wallet address can currently issue credentials. It does not prove historical authorization beyond what the immutable smart contract records.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
