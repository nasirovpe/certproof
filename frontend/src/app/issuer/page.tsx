'use client';

import React, { useEffect, useState, useRef } from 'react';
import { useAccount, useChainId } from 'wagmi';
import { useSession } from '@/context/SessionContext';
import { getClientEnv } from '@/lib/config/env';
import CertificateRegistration from '@/components/certificate/CertificateRegistration';
import IssuerCertificateList from '@/components/certificate/IssuerCertificateList';

interface IssuerStatusResponse {
  authenticated: boolean;
  walletAddress?: string;
  registryAddress?: string;
  chainId?: number;
  contractDeployed?: boolean;
  isAuthorized?: boolean;
  error?: string;
  message?: string;
}

export default function IssuerPage() {
  const { address, isConnected } = useAccount();
  const currentChainId = useChainId();
  const { session, loading: sessionLoading, signIn, logout } = useSession();

  const [statusData, setStatusData] = useState<IssuerStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState<boolean>(false);
  const [rpcError, setRpcError] = useState<string | null>(null);
  const [listRefreshKey, setListRefreshKey] = useState<number>(0);

  const clientEnv = getClientEnv();
  const targetChainId = clientEnv.NEXT_PUBLIC_CHAIN_ID;
  const isWrongNetwork = isConnected && currentChainId !== targetChainId;

  // Active address tracking to prevent race conditions from delayed responses
  const activeAddressRef = useRef<string | undefined>(address);
  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  const isWalletMatched =
    Boolean(session?.authenticated) &&
    Boolean(address) &&
    session?.address?.toLowerCase() === address?.toLowerCase();

  // Fetch issuer status whenever session and matched wallet are active
  useEffect(() => {
    // If not authenticated, wallet disconnected/mismatched, or wrong network: immediately clear private UI state
    if (!session?.authenticated || !isConnected || !isWalletMatched || isWrongNetwork) {
      setStatusData(null);
      setRpcError(null);
      setStatusLoading(false);
      return;
    }

    let isCancelled = false;
    const fetchIssuerStatus = async () => {
      setStatusLoading(true);
      setRpcError(null);
      const queryAddress = address?.toLowerCase();
      const queryChainId = currentChainId;

      try {
        const res = await fetch('/api/issuer/status', {
          cache: 'no-store',
          headers: { 'Cache-Control': 'no-store' },
        });

        if (
          isCancelled ||
          activeAddressRef.current?.toLowerCase() !== queryAddress ||
          queryChainId !== targetChainId
        ) {
          // State changed while request was in-flight: discard response!
          return;
        }

        const data: IssuerStatusResponse = await res.json();

        if (
          isCancelled ||
          activeAddressRef.current?.toLowerCase() !== queryAddress ||
          queryChainId !== targetChainId
        ) {
          return;
        }

        if (res.status === 503 || data.error === 'RPC_ERROR') {
          setRpcError(data.message || 'RPC transport unreachable. Not an authorization failure.');
          setStatusData(null);
          return;
        }

        if (!res.ok) {
          throw new Error(data.message || 'Failed to inspect issuer status.');
        }

        setStatusData(data);
      } catch (err: unknown) {
        if (!isCancelled && activeAddressRef.current?.toLowerCase() === queryAddress) {
          setRpcError(err instanceof Error ? err.message : 'Network or RPC query error.');
          setStatusData(null);
        }
      } finally {
        if (!isCancelled) {
          setStatusLoading(false);
        }
      }
    };

    fetchIssuerStatus();

    return () => {
      isCancelled = true;
    };
  }, [session, isConnected, isWalletMatched, isWrongNetwork, address, currentChainId, targetChainId]);

  return (
    <div className="flex-1 max-w-4xl w-full mx-auto px-4 py-10 space-y-8">
      {/* Header */}
      <div className="border-b border-slate-800 pb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          Issuer Management Portal
        </h1>
        <p className="text-sm text-slate-400 mt-1">
          Sprint 3 Stage 1: Wallet Connection & SIWE Authentication Verification
        </p>
      </div>

      {/* 1. DISCONNECTED STATE */}
      {!isConnected && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-slate-800 text-slate-400 flex items-center justify-center mx-auto text-xl font-bold">
            🔒
          </div>
          <h2 className="text-lg font-semibold text-slate-200">Wallet Disconnected</h2>
          <p className="text-sm text-slate-400 max-w-md mx-auto">
            Connect an authorized institution wallet using the button in the top navigation to begin.
          </p>
        </div>
      )}

      {/* 2. WRONG NETWORK STATE */}
      {isConnected && isWrongNetwork && (
        <div className="bg-rose-950/40 border border-rose-900/60 rounded-xl p-6 space-y-3">
          <div className="flex items-center gap-2 text-rose-300 font-semibold text-sm">
            <span>⚠️ Unsupported Network</span>
          </div>
          <p className="text-xs text-rose-200 leading-relaxed">
            Your wallet is currently connected to Chain ID <span className="font-mono font-bold">{currentChainId}</span>.
            CertProof is configured for Chain ID <span className="font-mono font-bold">{targetChainId}</span> ({targetChainId === 31337 ? 'Local Anvil' : 'Sepolia'}).
            Please switch networks using your wallet.
          </p>
        </div>
      )}

      {/* 3. CONNECTED BUT UNAUTHENTICATED STATE */}
      {isConnected && !isWrongNetwork && !session?.authenticated && (
        <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-8 space-y-6">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-200">Wallet Connected — Authentication Required</h2>
              <p className="text-xs text-slate-400 mt-1">
                Connected address: <span className="font-mono text-indigo-300 font-semibold">{address}</span>
              </p>
            </div>
            <span className="text-[11px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2.5 py-1 rounded-full font-medium">
              Not Authenticated
            </span>
          </div>

          <div className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-lg text-xs text-slate-400 space-y-2">
            <p>
              <strong className="text-slate-200">Connecting a wallet does not authenticate you.</strong>
            </p>
            <p>
              To access protected issuer controls, you must sign an EIP-4361 (SIWE) message.
              This cryptographically confirms wallet ownership without transferring tokens or gas.
            </p>
          </div>

          <button
            onClick={() => signIn()}
            disabled={sessionLoading}
            className="w-full sm:w-auto px-6 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 text-white font-medium text-sm rounded-lg shadow transition-colors flex items-center justify-center gap-2"
          >
            {sessionLoading ? 'Preparing SIWE Signature...' : 'Sign In with Ethereum (SIWE)'}
          </button>
        </div>
      )}

      {/* 4. WALLET / SESSION MISMATCH STATE */}
      {isConnected && !isWrongNetwork && session?.authenticated && !isWalletMatched && (
        <div className="bg-amber-950/40 border border-amber-900/60 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-2 text-amber-300 font-semibold text-sm">
            <span>⚠️ Wallet / Session Mismatch Detected</span>
          </div>
          <p className="text-xs text-amber-200 leading-relaxed">
            The active browser session belongs to <span className="font-mono font-bold">{session.address}</span>,
            but your connected wallet is <span className="font-mono font-bold">{address}</span>.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => signIn()}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-lg transition-colors"
            >
              Re-authenticate Connected Wallet
            </button>
            <button
              onClick={() => logout()}
              className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors"
            >
              Log Out Session
            </button>
          </div>
        </div>
      )}

      {/* 5. AUTHENTICATED STATE — PROTECTED ACCOUNT DETAILS */}
      {isConnected && !isWrongNetwork && isWalletMatched && (
        <div className="space-y-6">
          {/* Session Overview Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-4">
              <div>
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Active Authenticated Session
                </span>
                <p className="font-mono text-sm sm:text-base font-bold text-white break-all">
                  {session?.address}
                </p>
              </div>
              <button
                onClick={() => logout()}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium rounded-lg transition-colors"
              >
                Sign Out
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs pt-1">
              <div>
                <span className="text-slate-500 block">Session Expiry</span>
                <span className="text-slate-300 font-mono">
                  {session?.expiresAt ? new Date(session.expiresAt).toLocaleString() : 'Active'}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Configured Chain</span>
                <span className="text-slate-300 font-mono">
                  {targetChainId} ({targetChainId === 31337 ? 'Anvil' : 'Sepolia'})
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Registry Contract</span>
                <span className="text-slate-300 font-mono truncate block" title={clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS}>
                  {clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS}
                </span>
              </div>
            </div>
          </div>

          {/* On-Chain Issuer Authorization Status Card */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-200">
                On-Chain Issuer Authorization
              </h2>
              {statusLoading && (
                <span className="text-xs text-indigo-400 animate-pulse">Checking Registry...</span>
              )}
            </div>

            {/* A. RPC ERROR (Explicitly NOT reported as Unauthorized) */}
            {rpcError && (
              <div className="bg-amber-950/40 border border-amber-900/60 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-amber-300 font-semibold text-xs">
                  <span>⚠️ RPC Node Query Unavailable</span>
                </div>
                <p className="text-xs text-amber-200">
                  {rpcError}
                </p>
                <p className="text-[11px] text-amber-300/80 font-medium">
                  Note: A network timeout or unreachable RPC node is never reported as &ldquo;Unauthorized&rdquo;.
                </p>
              </div>
            )}

            {/* B. MISSING DEPLOYMENT */}
            {statusData?.error === 'MISSING_DEPLOYMENT' && (
              <div className="bg-rose-950/40 border border-rose-900/60 rounded-lg p-4 space-y-2">
                <div className="text-rose-300 font-semibold text-xs">
                  Registry Contract Not Found
                </div>
                <p className="text-xs text-rose-200">
                  {statusData.message}
                </p>
              </div>
            )}

            {/* C. AUTHORIZED ISSUER */}
            {statusData && statusData.contractDeployed && statusData.isAuthorized && (
              <div className="bg-emerald-950/40 border border-emerald-900/60 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block" />
                  <span className="text-emerald-300 font-bold text-sm">
                    Authorized Registry Issuer
                  </span>
                </div>
                <p className="text-xs text-emerald-200/90 leading-relaxed">
                  Your connected wallet is recognized as an active, authorized credential issuer in{' '}
                  <span className="font-mono">{statusData.registryAddress}</span>.
                </p>
              </div>
            )}

            {/* D. UNAUTHORIZED ISSUER */}
            {statusData && statusData.contractDeployed && !statusData.isAuthorized && !statusData.error && (
              <div className="bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
                  <span className="text-amber-300 font-bold text-sm">
                    Issuer Not Authorized On-Chain
                  </span>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed">
                  You are authenticated with SIWE, but address{' '}
                  <span className="font-mono text-slate-300">{session?.address}</span> has not been authorized
                  by the registry administrator (<span className="font-mono text-slate-400">setIssuerAuthorization</span>).
                </p>
                <p className="text-xs text-slate-500">
                  New certificate registration is disabled. However, any previously issued certificates remain accessible in your certificate history below and can still be permanently revoked by your wallet.
                </p>
              </div>
            )}
          </div>

          {/* Certificate Registration: Gated by active on-chain authorization */}
          {statusData && statusData.contractDeployed && statusData.isAuthorized && (
            <CertificateRegistration onRegistrationSuccess={() => setListRefreshKey((k) => k + 1)} />
          )}

          {/* Certificate History & Revocation: Accessible to all authenticated issuers independently of current authorization */}
          {statusData && statusData.contractDeployed && (
            <IssuerCertificateList refreshTrigger={listRefreshKey} />
          )}
        </div>
      )}
    </div>
  );
}
