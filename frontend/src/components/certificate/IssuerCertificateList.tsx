'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useAccount, useChainId, usePublicClient } from 'wagmi';
import { Hex, createPublicClient, http } from 'viem';
import { anvilChain } from '@/lib/config/chains';
import { getClientEnv } from '@/lib/config/env';
import { fetchIssuerCertificates, DEFAULT_PAGE_SIZE } from '@/lib/certificate/registry';
import { IssuerCertificateItem } from '@/lib/certificate/types';
import { loadPendingRevocation } from '@/lib/certificate/storage';
import RevocationDialog from './RevocationDialog';
import { CertificateShareControls } from './CertificateShareControls';

interface IssuerCertificateListProps {
  refreshTrigger?: number;
}

export default function IssuerCertificateList({
  refreshTrigger = 0,
}: IssuerCertificateListProps) {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const wagmiPublicClient = usePublicClient();

  const clientEnv = getClientEnv();
  const targetChainId = clientEnv.NEXT_PUBLIC_CHAIN_ID;
  const registryAddress = clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS;
  const rpcUrl =
    targetChainId === 31337
      ? clientEnv.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545'
      : clientEnv.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org';

  const [certificates, setCertificates] = useState<IssuerCertificateItem[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Revocation modal state
  const [selectedCertForRevocation, setSelectedCertForRevocation] =
    useState<IssuerCertificateItem | null>(null);
  const [isRevokeModalOpen, setIsRevokeModalOpen] = useState<boolean>(false);
  const [recoveredRevocationTxHash, setRecoveredRevocationTxHash] = useState<Hex | undefined>(
    undefined
  );

  // Active account and chain refs to discard delayed in-flight responses
  const activeAddressRef = useRef<string | undefined>(address);
  const activeChainRef = useRef<number>(currentChainId);
  const fetchRequestIdRef = useRef<number>(0);

  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  useEffect(() => {
    activeChainRef.current = currentChainId;
  }, [currentChainId]);

  const wagmiPublicClientRef = useRef(wagmiPublicClient);
  useEffect(() => {
    wagmiPublicClientRef.current = wagmiPublicClient;
  }, [wagmiPublicClient]);

  const getActiveClient = useCallback(() => {
    if (wagmiPublicClientRef.current) return wagmiPublicClientRef.current;
    return createPublicClient({
      chain: anvilChain,
      transport: http(rpcUrl, { timeout: 4000 }),
    });
  }, [rpcUrl]);

  // Load certificates for the active page
  const loadCertificates = useCallback(
    async (pageToLoad: number) => {
      // 1. Immediately clear if wallet disconnected, out-of-scope, or wrong network
      if (!isConnected || !address || currentChainId !== targetChainId) {
        setCertificates([]);
        setTotalCount(0);
        setRpcError(null);
        setLoading(false);
        return;
      }

      const queryAddress = address.toLowerCase();
      const queryChain = currentChainId;
      const currentRequestId = ++fetchRequestIdRef.current;

      setLoading(true);
      setRpcError(null);

      try {
        const client = getActiveClient();
        const offset = BigInt((pageToLoad - 1) * DEFAULT_PAGE_SIZE);

        const result = await fetchIssuerCertificates(
          client,
          registryAddress,
          address as `0x${string}`,
          offset,
          BigInt(DEFAULT_PAGE_SIZE)
        );

        // Guard against race conditions: Discard if active account or chain changed
        if (
          currentRequestId !== fetchRequestIdRef.current ||
          activeAddressRef.current?.toLowerCase() !== queryAddress ||
          activeChainRef.current !== queryChain
        ) {
          return;
        }

        setCertificates(result.items);
        setTotalCount(result.total);
        setCurrentPage(pageToLoad);
      } catch (err: unknown) {
        if (
          currentRequestId === fetchRequestIdRef.current &&
          activeAddressRef.current?.toLowerCase() === queryAddress
        ) {
          setRpcError(
            err instanceof Error
              ? err.message
              : 'Failed to query certificate list from Ethereum node.'
          );
        }
      } finally {
        if (currentRequestId === fetchRequestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [isConnected, address, currentChainId, targetChainId, registryAddress, getActiveClient]
  );

  // Clear immediately on account switch, network change, or disconnect
  useEffect(() => {
    setCurrentPage(1);
    setCertificates([]);
    setTotalCount(0);
    setRpcError(null);
    setIsRevokeModalOpen(false);
    setSelectedCertForRevocation(null);
    setRecoveredRevocationTxHash(undefined);
    loadCertificates(1);
  }, [address, currentChainId, refreshTrigger, loadCertificates]);

  // 2. Safe Pending-Revocation Recovery on Mount / Scope Change
  useEffect(() => {
    if (!isConnected || !address || currentChainId !== targetChainId) {
      return;
    }

    const draft = loadPendingRevocation({
      issuerAddress: address,
      chainId: targetChainId,
      registryAddress,
    });

    if (draft && draft.txHash) {
      const recoveredItem: IssuerCertificateItem = {
        certId: draft.certId,
        documentHash: draft.documentHash,
        issuer: draft.issuerAddress,
        registeredAt: 0,
        revokedAt: 0,
        revoked: false,
        isIssuerCurrentlyAuthorized: false,
      };
      setSelectedCertForRevocation(recoveredItem);
      setRecoveredRevocationTxHash(draft.txHash);
      setIsRevokeModalOpen(true);
    }
  }, [isConnected, address, currentChainId, targetChainId, registryAddress]);

  const totalPages = Math.max(1, Math.ceil(totalCount / DEFAULT_PAGE_SIZE));

  const copyToClipboard = (text: string, id: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    }
  };

  const handleOpenRevokeModal = (cert: IssuerCertificateItem) => {
    setSelectedCertForRevocation(cert);
    setRecoveredRevocationTxHash(undefined);
    setIsRevokeModalOpen(true);
  };

  const handleCloseRevokeModal = () => {
    setIsRevokeModalOpen(false);
    setSelectedCertForRevocation(null);
    setRecoveredRevocationTxHash(undefined);
  };

  const handleRevocationSuccess = (revokedCertId: Hex, authoritativeRevokedAt: number) => {
    // 1. Instantly update affected entry in state so UI reflects it immediately
    setCertificates((prev) =>
      prev.map((item) =>
        item.certId.toLowerCase() === revokedCertId.toLowerCase()
          ? { ...item, revoked: true, revokedAt: authoritativeRevokedAt }
          : item
      )
    );
    // 2. Reload active page to refresh on-chain state, preserving pagination position
    loadCertificates(currentPage);
  };

  return (
    <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Issued Certificates</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Bounded on-chain query (<code className="text-slate-300">getIssuerCertificates</code>). Directly read from Ethereum without an off-chain indexer.
          </p>
        </div>
        <div className="text-xs text-slate-400 font-medium">
          Total Issued: <span className="text-indigo-400 font-bold font-mono">{totalCount}</span>
        </div>
      </div>

      {/* ERROR STATE */}
      {rpcError && (
        <div className="bg-amber-950/40 border border-amber-900/60 rounded-lg p-4 space-y-2 text-xs text-amber-200">
          <div className="font-semibold text-amber-300">⚠️ RPC Query Error</div>
          <p>{rpcError}</p>
          <button
            onClick={() => loadCertificates(currentPage)}
            className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded text-xs transition-colors"
          >
            Retry Connection
          </button>
        </div>
      )}

      {/* LOADING STATE */}
      {loading && (
        <div className="py-12 text-center text-xs text-indigo-400 animate-pulse space-y-2">
          <div className="text-2xl font-bold">⛓️</div>
          <div>Reading Certificate Records from Contract...</div>
        </div>
      )}

      {/* EMPTY STATE */}
      {!loading && !rpcError && totalCount === 0 && (
        <div className="bg-slate-950/40 border border-slate-800/80 rounded-xl p-8 text-center space-y-2">
          <div className="w-10 h-10 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto text-lg font-bold">
            📜
          </div>
          <div className="text-sm font-medium text-slate-300">No Certificates Registered</div>
          <p className="text-xs text-slate-500 max-w-sm mx-auto">
            This wallet address has not registered any certificates under the active contract. Use the registration module above to anchor your first document.
          </p>
        </div>
      )}

      {/* CERTIFICATE TABLE */}
      {!loading && !rpcError && totalCount > 0 && (
        <div className="space-y-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border border-slate-800 rounded-lg overflow-hidden">
              <thead className="bg-slate-950 text-slate-400 uppercase tracking-wider font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Certificate ID</th>
                  <th className="py-3 px-4">Document Hash</th>
                  <th className="py-3 px-4">Registered At</th>
                  <th className="py-3 px-4">Revocation Status</th>
                  <th className="py-3 px-4">Current Authorization</th>
                  <th className="py-3 px-4 text-center">Share & QR</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 font-mono">
                {certificates.map((cert) => {
                  const isRevoked = cert.revoked;
                  const isAuth = cert.isIssuerCurrentlyAuthorized;
                  const isOwner = cert.issuer.toLowerCase() === address?.toLowerCase();

                  return (
                    <tr
                      key={cert.certId}
                      className="hover:bg-slate-800/40 transition-colors"
                    >
                      {/* 1. Certificate ID */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="text-indigo-300">
                            {cert.certId.slice(0, 10)}...{cert.certId.slice(-8)}
                          </span>
                          <button
                            onClick={() => copyToClipboard(cert.certId, cert.certId)}
                            title="Copy full Certificate ID"
                            className="text-slate-500 hover:text-slate-300 text-[11px] px-1 py-0.5 rounded bg-slate-800"
                          >
                            {copiedId === cert.certId ? '✓' : 'Copy'}
                          </button>
                        </div>
                      </td>

                      {/* 2. Document Hash */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-1.5">
                          <span className="text-emerald-300">
                            {cert.documentHash.slice(0, 10)}...{cert.documentHash.slice(-8)}
                          </span>
                          <button
                            onClick={() =>
                              copyToClipboard(cert.documentHash, `doc-${cert.certId}`)
                            }
                            title="Copy Keccak-256 Document Hash"
                            className="text-slate-500 hover:text-slate-300 text-[11px] px-1 py-0.5 rounded bg-slate-800"
                          >
                            {copiedId === `doc-${cert.certId}` ? '✓' : 'Copy'}
                          </button>
                        </div>
                      </td>

                      {/* 3. Registered Timestamp */}
                      <td className="py-3.5 px-4 text-slate-300 font-sans">
                        {cert.registeredAt > 0
                          ? new Date(cert.registeredAt * 1000).toLocaleString()
                          : 'Unknown'}
                      </td>

                      {/* 4. Revocation Fact */}
                      <td className="py-3.5 px-4 font-sans">
                        {isRevoked ? (
                          <div className="space-y-0.5">
                            <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20">
                              Revoked
                            </span>
                            {cert.revokedAt > 0 && (
                              <div className="text-[10px] text-rose-300/80 font-mono">
                                {new Date(cert.revokedAt * 1000).toLocaleString()}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Active
                          </span>
                        )}
                      </td>

                      {/* 5. Current Issuer Authorization Fact */}
                      <td className="py-3.5 px-4 font-sans">
                        {isAuth ? (
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                            Authorized
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950 text-amber-300 border border-amber-800/40">
                            De-authorized
                          </span>
                        )}
                      </td>

                      {/* 6. Share & QR Controls (available for active, revoked, and deauthorized records) */}
                      <td className="py-3.5 px-4 text-center font-sans">
                        <CertificateShareControls
                          certId={cert.certId}
                          chainId={targetChainId}
                          registryAddress={registryAddress}
                          isRevoked={isRevoked}
                          isIssuerAuthorized={isAuth}
                        />
                      </td>

                      {/* 7. Revocation Action */}
                      <td className="py-3.5 px-4 text-right font-sans">
                        {isRevoked ? (
                          <span className="text-[11px] text-slate-600 font-mono">
                            —
                          </span>
                        ) : (
                          <button
                            onClick={() => handleOpenRevokeModal(cert)}
                            disabled={!isOwner}
                            className="px-2.5 py-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 hover:border-rose-500/50 rounded text-[11px] font-semibold transition-colors disabled:opacity-40"
                            title={
                              !isOwner
                                ? 'Only the original issuing wallet can revoke this certificate'
                                : 'Revoke certificate permanently'
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* EXPLANATORY FOOTNOTE ON DECOUPLED DIMENSIONS */}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Note: Registration existence, revocation status, and current issuer authorization are independent operational facts. Revoked certificates permanently remain in registry history.
          </p>

          {/* PAGINATION CONTROLS */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80 text-xs">
            <span className="text-slate-400">
              Page <span className="font-semibold text-white">{currentPage}</span> of{' '}
              <span className="font-semibold text-white">{totalPages}</span> (Showing up to{' '}
              {DEFAULT_PAGE_SIZE} per page)
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => loadCertificates(currentPage - 1)}
                disabled={currentPage <= 1 || loading}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 text-slate-300 rounded font-medium transition-colors"
              >
                &larr; Previous
              </button>
              <button
                onClick={() => loadCertificates(currentPage + 1)}
                disabled={currentPage >= totalPages || loading}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 disabled:text-slate-600 text-slate-300 rounded font-medium transition-colors"
              >
                Next &rarr;
              </button>
            </div>
          </div>
        </div>
      )}

      {/* REVOCATION MODAL */}
      {selectedCertForRevocation && (
        <RevocationDialog
          certificate={selectedCertForRevocation}
          isOpen={isRevokeModalOpen}
          onClose={handleCloseRevokeModal}
          onRevocationSuccess={handleRevocationSuccess}
          initialTxHash={recoveredRevocationTxHash}
        />
      )}
    </div>
  );
}
