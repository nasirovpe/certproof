'use client';

import React, { useState } from 'react';
import {
  buildCanonicalVerificationUrl,
  generateVerificationQrDataUrl,
  getSafeQrFilename,
  triggerQrDownload,
} from '@/lib/certificate/share';
import { CertificateShareModal } from './CertificateShareModal';
import { QrCode, Copy, Check, ExternalLink, Download } from 'lucide-react';

interface CertificateShareControlsProps {
  certId: string;
  chainId: number;
  registryAddress: string;
  isRevoked?: boolean;
  isIssuerAuthorized?: boolean;
  variant?: 'table-actions' | 'card' | 'inline';
}

export function CertificateShareControls({
  certId,
  chainId,
  registryAddress,
  isRevoked = false,
  isIssuerAuthorized = true,
  variant = 'table-actions',
}: CertificateShareControlsProps) {
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [downloading, setDownloading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  let canonicalUrl = '';
  try {
    canonicalUrl = buildCanonicalVerificationUrl({
      certId,
      chainId,
      registryAddress,
    });
  } catch (err: unknown) {
    // If URL cannot be built (e.g. malformed ID or unsupported chain), capture error
    canonicalUrl = '';
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canonicalUrl) {
      setErrorMsg('Cannot construct canonical link.');
      return;
    }
    setErrorMsg(null);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(canonicalUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setErrorMsg('Failed to copy link.');
      setTimeout(() => setErrorMsg(null), 3000);
    }
  };

  const handleDirectDownload = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!canonicalUrl) {
      setErrorMsg('Cannot construct canonical link.');
      return;
    }
    setErrorMsg(null);
    setDownloading(true);
    try {
      const dataUrl = await generateVerificationQrDataUrl(canonicalUrl, { width: 512, margin: 4 });
      const filename = getSafeQrFilename(certId);
      triggerQrDownload(dataUrl, filename);
    } catch {
      setErrorMsg('Failed to download QR.');
      setTimeout(() => setErrorMsg(null), 3000);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <>
      <div className="inline-flex items-center gap-1.5">
        {/* 1. Copy verification link button */}
        <button
          type="button"
          onClick={handleCopy}
          aria-label={`Copy verification link for certificate ${certId.slice(0, 10)}`}
          title={copied ? 'Copied to clipboard!' : 'Copy verification link'}
          className="p-1 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>

        {/* 2. Open verification page link */}
        {canonicalUrl && (
          <a
            href={canonicalUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Open verification page for certificate ${certId.slice(0, 10)}`}
            title="Open public verification page"
            className="p-1 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        )}

        {/* 3. Direct Download QR button */}
        <button
          type="button"
          onClick={handleDirectDownload}
          disabled={downloading || !canonicalUrl}
          aria-label={`Download QR code for certificate ${certId.slice(0, 10)}`}
          title={downloading ? 'Generating QR...' : 'Download verification QR (PNG)'}
          className="p-1 rounded text-slate-400 hover:text-indigo-300 hover:bg-slate-800 transition-colors disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />
        </button>

        {/* 4. Open full Share & QR modal */}
        <button
          type="button"
          onClick={() => setIsModalOpen(true)}
          aria-label={`Open share and QR modal for certificate ${certId.slice(0, 10)}`}
          title="Open Share & QR Dialog"
          className="px-2 py-0.5 rounded text-[11px] font-medium bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 border border-indigo-500/30 transition-colors flex items-center gap-1"
        >
          <QrCode className="w-3 h-3" />
          <span>Share</span>
        </button>
      </div>

      {errorMsg && (
        <span className="block text-[10px] text-rose-400 mt-0.5">{errorMsg}</span>
      )}

      {/* Share Modal */}
      <CertificateShareModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        certId={certId}
        chainId={chainId}
        registryAddress={registryAddress}
        isRevoked={isRevoked}
        isIssuerAuthorized={isIssuerAuthorized}
      />
    </>
  );
}
