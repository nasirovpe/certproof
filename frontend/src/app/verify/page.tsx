'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import { isValidCertId } from '@/lib/certificate/registry';

export default function VerifyIndexPage() {
  const router = useRouter();
  const [inputVal, setInputVal] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = inputVal.trim();
    if (!cleanId) {
      setError('Please enter a certificate ID.');
      return;
    }

    if (!isValidCertId(cleanId)) {
      setError('Invalid format: Certificate ID must be a 66-character hexadecimal string starting with 0x.');
      return;
    }

    router.push(`/verify/${cleanId}`);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
        <div className="space-y-2 text-center">
          <div className="w-12 h-12 rounded-xl bg-indigo-500/10 text-indigo-400 flex items-center justify-center mx-auto mb-3">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Public Document Verifier</h1>
          <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            Enter the 66-character opaque Certificate ID to inspect authoritative on-chain registration and compare candidate PDF bytes locally.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="certIdInput" className="block text-xs font-semibold text-slate-300 mb-1.5">
              Certificate Identifier (bytes32)
            </label>
            <input
              id="certIdInput"
              type="text"
              value={inputVal}
              onChange={(e) => {
                setInputVal(e.target.value);
                if (error) setError(null);
              }}
              placeholder="0x..."
              className="w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 placeholder-slate-600 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-950/40 border border-rose-900/50 rounded-xl text-xs text-rose-300">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2"
          >
            <span>Inspect Certificate Record</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="pt-2 text-center text-[11px] text-slate-500">
          Zero authentication required • No wallet connection needed • Browser-local PDF evaluation
        </div>
      </div>
    </div>
  );
}
