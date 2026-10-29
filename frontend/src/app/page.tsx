'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Search, FileCheck } from 'lucide-react';
import { isValidCertId } from '@/lib/certificate/registry';

export default function HomePage() {
  const router = useRouter();
  const [certIdInput, setCertIdInput] = useState<string>('');
  const [inputError, setInputError] = useState<string | null>(null);

  const handleVerifySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanId = certIdInput.trim();
    if (!cleanId) {
      setInputError('Please enter a certificate ID.');
      return;
    }
    if (!isValidCertId(cleanId)) {
      setInputError('Invalid format: Certificate ID must be a 66-character hexadecimal string starting with 0x.');
      return;
    }
    router.push(`/verify/${cleanId}`);
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-16 sm:py-24">
      <div className="max-w-3xl text-center space-y-6">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
          <span>Sprint 4 Stage 1</span>
          <span className="w-1 h-1 rounded-full bg-indigo-400" />
          <span>Public Verifier & In-Memory Hash Engine</span>
        </div>

        <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-white">
          Decentralized Credential Verification on{' '}
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-cyan-400">
            Ethereum
          </span>
        </h1>

        <p className="text-base sm:text-lg text-slate-400 max-w-2xl mx-auto leading-relaxed">
          CertProof anchors unaltered cryptographic document digests to smart contracts.
          No personal data, grades, or PDF bytes are stored on-chain.
        </p>

        {/* Public Quick-Access Verification Box */}
        <div className="pt-4 max-w-xl mx-auto w-full">
          <form onSubmit={handleVerifySubmit} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
              <Search className="w-3.5 h-3.5 text-indigo-400" />
              <span>Public Verification Quick-Access</span>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={certIdInput}
                onChange={(e) => {
                  setCertIdInput(e.target.value);
                  if (inputError) setInputError(null);
                }}
                placeholder="Enter 66-character Certificate ID (0x...)"
                className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-200 placeholder-slate-600 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors"
              />
              <button
                type="submit"
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 shrink-0"
              >
                <span>Verify</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
            {inputError && (
              <p className="text-left text-xs text-rose-400 pt-0.5">{inputError}</p>
            )}
          </form>
        </div>

        <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link
            href="/issuer"
            className="w-full sm:w-auto px-6 py-3 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2"
          >
            Access Issuer Portal &rarr;
          </Link>
          <Link
            href="/verify"
            className="w-full sm:w-auto px-6 py-3 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-400 font-semibold rounded-xl transition-all text-sm flex items-center justify-center gap-2"
          >
            <FileCheck className="w-4 h-4 text-slate-400" />
            <span>Open Public Verifier</span>
          </Link>
        </div>

        {/* Feature Highlights Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-12 text-left">
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-sm">
              1
            </div>
            <h3 className="font-semibold text-slate-200 text-sm">Zero-Auth Public Verification</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Read authoritative records directly from Ethereum. No wallet connection, SIWE session, or database required.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 text-cyan-400 flex items-center justify-center font-bold text-sm">
              2
            </div>
            <h3 className="font-semibold text-slate-200 text-sm">Browser-Local PDF Hashing</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Keccak-256 fingerprint computed in browser memory via background Web Worker. Candidate PDFs are never uploaded.
            </p>
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-sm">
              3
            </div>
            <h3 className="font-semibold text-slate-200 text-sm">Independent Facts Model</h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              Separates existence, file match, revocation status, and issuer authorization. Never collapses facts into a single badge.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
