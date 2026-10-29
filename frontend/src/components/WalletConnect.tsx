'use client';

import React, { useState } from 'react';
import { useAccount, useConnect, useDisconnect, useChainId, useSwitchChain } from 'wagmi';
import { useSession } from '@/context/SessionContext';
import { getClientEnv } from '@/lib/config/env';

export function WalletConnect() {
  const { address, isConnected, status: accountStatus } = useAccount();
  const { connectors, connect, isPending: isConnecting, error: connectError } = useConnect();
  const { disconnect } = useDisconnect();
  const currentChainId = useChainId();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { session, signIn, logout, loading: sessionLoading, error: sessionError } = useSession();

  const [uiError, setUiError] = useState<string | null>(null);

  const clientEnv = getClientEnv();
  const targetChainId = clientEnv.NEXT_PUBLIC_CHAIN_ID;
  const isWrongNetwork = isConnected && currentChainId !== targetChainId;

  // Address matching
  const isSessionMatched =
    Boolean(session?.authenticated) &&
    Boolean(address) &&
    session?.address?.toLowerCase() === address?.toLowerCase();

  const handleConnect = async () => {
    setUiError(null);
    const injectedConnector = connectors.find((c) => c.type === 'injected');
    if (!injectedConnector) {
      setUiError('No injected EVM wallet found. Please install MetaMask or a compatible browser extension.');
      return;
    }

    try {
      connect({ connector: injectedConnector });
    } catch (err: unknown) {
      setUiError(err instanceof Error ? err.message : 'Wallet connection failed.');
    }
  };

  const handleDisconnect = async () => {
    if (session?.authenticated) {
      await logout();
    } else {
      disconnect();
    }
  };

  const handleSwitchNetwork = () => {
    if (switchChain) {
      switchChain({ chainId: targetChainId as 31337 | 11155111 });
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-center gap-3">
      {/* 1. DISCONNECTED STATE */}
      {!isConnected && (
        <button
          onClick={handleConnect}
          disabled={isConnecting}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-800 text-white font-medium rounded-lg shadow transition-colors text-sm flex items-center gap-2"
        >
          {isConnecting ? (
            <>
              <span className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
              Connecting...
            </>
          ) : (
            'Connect Wallet'
          )}
        </button>
      )}

      {/* 2. WRONG NETWORK STATE */}
      {isWrongNetwork && (
        <button
          onClick={handleSwitchNetwork}
          disabled={isSwitching}
          className="px-3 py-1.5 bg-rose-600 hover:bg-rose-500 text-white font-medium rounded-md text-xs transition-colors shadow flex items-center gap-1.5"
        >
          {isSwitching ? 'Switching Chain...' : `Switch to ${targetChainId === 31337 ? 'Anvil' : 'Sepolia'}`}
        </button>
      )}

      {/* 3. CONNECTED BUT UNAUTHENTICATED (OR MISMATCHED) */}
      {isConnected && !isSessionMatched && (
        <div className="flex items-center gap-2">
          <div className="text-xs bg-slate-800 border border-slate-700 rounded-lg px-3 py-1.5 text-slate-300">
            <span className="text-slate-500 mr-1.5">Connected:</span>
            <span className="font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
          </div>

          <button
            onClick={() => signIn()}
            disabled={sessionLoading || isWrongNetwork}
            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-800 disabled:opacity-50 text-white font-medium rounded-md text-xs transition-colors shadow flex items-center gap-1.5"
          >
            {sessionLoading ? 'Signing In...' : 'Sign In with Ethereum'}
          </button>

          <button
            onClick={handleDisconnect}
            className="px-2 py-1.5 text-slate-400 hover:text-slate-200 text-xs transition-colors"
          >
            Disconnect
          </button>
        </div>
      )}

      {/* 4. AUTHENTICATED STATE */}
      {isConnected && isSessionMatched && (
        <div className="flex items-center gap-2">
          <div className="text-xs bg-emerald-950/80 border border-emerald-800/80 rounded-lg px-3 py-1.5 text-emerald-200 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" />
            <span className="font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</span>
            <span className="text-[10px] bg-emerald-800/60 text-emerald-300 px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider">
              SIWE Verified
            </span>
          </div>

          <button
            onClick={() => logout()}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-medium rounded-md transition-colors"
          >
            Sign Out
          </button>
        </div>
      )}

      {/* Error messages */}
      {(uiError || connectError || sessionError) && (
        <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/60 px-3 py-1 rounded">
          {uiError || connectError?.message || sessionError}
        </div>
      )}
    </div>
  );
}
