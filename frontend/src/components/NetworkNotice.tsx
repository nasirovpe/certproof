'use client';

import React from 'react';
import { useChainId } from 'wagmi';
import { getClientEnv } from '@/lib/config/env';

export function NetworkNotice() {
  const currentChainId = useChainId();
  const clientEnv = getClientEnv();
  const expectedChainId = clientEnv.NEXT_PUBLIC_CHAIN_ID;

  const isWrongNetwork = currentChainId && currentChainId !== expectedChainId;

  return (
    <div className="w-full bg-slate-900 border-b border-slate-800 text-xs px-4 py-2 text-slate-300">
      <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center space-x-2">
          <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span className="font-semibold text-amber-300 uppercase tracking-wider">
            Testnet / Local Development Mode
          </span>
          <span className="hidden sm:inline text-slate-400">
            — Operating on {expectedChainId === 31337 ? 'Local Anvil (31337)' : 'Ethereum Sepolia (11155111)'}. Do not submit real credentials.
          </span>
        </div>

        {isWrongNetwork && (
          <div className="text-rose-400 font-medium">
            ⚠️ Connected wallet is on Chain {currentChainId}. Please switch to {expectedChainId}.
          </div>
        )}
      </div>
    </div>
  );
}
