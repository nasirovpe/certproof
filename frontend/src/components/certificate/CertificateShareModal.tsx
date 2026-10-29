'use client';

import React, { useState, useEffect } from 'react';
import {
  buildCanonicalVerificationUrl,
  generateVerificationQrDataUrl,
  getSafeQrFilename,
  triggerQrDownload,
  isLocalOrigin,
  QR_LOOKUP_EXPLANATION,
  LOCALHOST_ORIGIN_NOTICE,
} from '@/lib/certificate/share';
import {
  QrCode,
  Copy,
  Check,
  ExternalLink,
  Download,
  X,
  AlertTriangle,
  Info,
  ShieldAlert,
} from 'lucide-react';

interface CertificateShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  certId: string;
  chainId: number;
  registryAddress: string;
  isRevoked?: boolean;
  isIssuerAuthorized?: boolean;
}

export function CertificateShareModal({
  isOpen,
  onClose,
  certId,
  chainId,
  registryAddress,
  isRevoked = false,
  isIssuerAuthorized = true,
}: CertificateShareModalProps) {
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loadingQr, setLoadingQr] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  // Compute canonical URL safely
  let canonicalUrl = '';
  let urlBuildError: string | null = null;
  try {
    canonicalUrl = buildCanonicalVerificationUrl({
      certId,
      chainId,
      registryAddress,
    });
  } catch (err: unknown) {
    urlBuildError = err instanceof Error ? err.message : String(err);
  }

  const isLocal = canonicalUrl ? isLocalOrigin(canonicalUrl) : false;

  // Generate QR code locally on open
  useEffect(() => {
    if (!isOpen || !canonicalUrl) {
      setQrDataUrl(null);
      return;
    }

    let isMounted = true;
    setLoadingQr(true);
    setDownloadError(null);

    generateVerificationQrDataUrl(canonicalUrl, { width: 512, margin: 4 })
      .then((dataUrl) => {
        if (isMounted) {
          setQrDataUrl(dataUrl);
          setLoadingQr(false);
        }
      })
      .catch((err) => {
        if (isMounted) {
          console.error('[QR] Failed to generate local QR code:', err);
          setDownloadError('Failed to generate QR code in memory.');
          setLoadingQr(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, [isOpen, canonicalUrl]);

  // Handle ESC key to close modal
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleCopy = async () => {
    if (!canonicalUrl) return;
    setCopyError(null);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(canonicalUrl);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        throw new Error('Clipboard API is not available.');
      }
    } catch (err) {
      console.error('[Share] Copy failed:', err);
      setCopyError('Unable to copy to clipboard.');
    }
  };

  const handleDownload = () => {
    if (!qrDataUrl) {
      setDownloadError('QR image is not ready for download.');
      return;
    }
    setDownloadError(null);
    try {
      const filename = getSafeQrFilename(certId);
      triggerQrDownload(qrDataUrl, filename);
    } catch (err) {
      console.error('[Share] Download failed:', err);
      setDownloadError('Failed to download QR image.');
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-xl shadow-2xl p-6 text-slate-100 font-sans space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-indigo-600/20 text-indigo-400 border border-indigo-500/30">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 id="share-modal-title" className="text-base font-bold text-white">
                Share Verification Link & QR
              </h2>
              <p className="text-xs text-slate-400">
                Public canonical lookup for Certificate ID
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close share dialog"
            className="text-slate-400 hover:text-white p-1 rounded-md hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Certificate Identity & Current Status Facts */}
        <div className="p-3 bg-slate-950/70 border border-slate-800 rounded-lg space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-slate-400">Certificate ID:</span>
            <span className="font-mono text-indigo-300 font-semibold truncate max-w-[280px]">
              {certId}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/80">
            <span className="text-slate-400 text-[11px]">On-Chain Facts:</span>
            {isRevoked ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/30">
                Permanently Revoked
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                Active (Not Revoked)
              </span>
            )}
            {isIssuerAuthorized ? (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-emerald-950 text-emerald-300 border border-emerald-800/40">
                Issuer Authorized
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-amber-950 text-amber-300 border border-amber-800/40">
                Issuer Deauthorized
              </span>
            )}
          </div>
        </div>

        {/* URL Error if Any */}
        {urlBuildError && (
          <div className="p-3 bg-rose-950/40 border border-rose-700/60 rounded-lg flex items-start gap-2.5 text-xs text-rose-300">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-rose-200">Cannot Construct Canonical Link</div>
              <div>{urlBuildError}</div>
            </div>
          </div>
        )}

        {/* QR Code Preview */}
        {!urlBuildError && (
          <div className="flex flex-col items-center justify-center p-4 bg-slate-950 border border-slate-800 rounded-lg space-y-3">
            <div className="w-48 h-48 bg-white rounded-lg p-2.5 flex items-center justify-center shadow-inner">
              {loadingQr ? (
                <div className="text-xs text-slate-700 font-medium animate-pulse">
                  Generating QR...
                </div>
              ) : qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt={`Verification QR code for certificate ${certId}`}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-xs text-rose-600 font-medium">QR Unavailable</div>
              )}
            </div>

            <p className="text-[11px] text-slate-400 text-center max-w-sm">
              512×512 PNG with quiet zone and contrast. Encodes only the canonical verification URL.
            </p>
          </div>
        )}

        {/* Action Controls: Copy, Open, Download */}
        {!urlBuildError && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* 1. Copy Link */}
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy canonical verification link"
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold shadow transition-colors"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                <span>{copied ? 'Copied Link!' : 'Copy Link'}</span>
              </button>

              {/* 2. Open Verification Page */}
              <a
                href={canonicalUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Open verification page in new tab"
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-colors text-center"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Open Page</span>
              </a>

              {/* 3. Download QR */}
              <button
                type="button"
                onClick={handleDownload}
                disabled={!qrDataUrl || loadingQr}
                aria-label="Download QR code image as PNG"
                className="flex items-center justify-center gap-1.5 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 text-center"
              >
                <Download className="w-4 h-4" />
                <span>Download QR</span>
              </button>
            </div>

            {/* Error indicators */}
            {copyError && (
              <div className="text-[11px] text-rose-400 text-center">{copyError}</div>
            )}
            {downloadError && (
              <div className="text-[11px] text-rose-400 text-center">{downloadError}</div>
            )}

            {/* Read-only canonical URL display */}
            <div className="space-y-1">
              <label htmlFor="canonical-url-display" className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                Canonical Verification URL
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="canonical-url-display"
                  type="text"
                  readOnly
                  value={canonicalUrl}
                  className="w-full text-xs font-mono bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-slate-300 select-all focus:outline-none"
                />
              </div>
            </div>
          </div>
        )}

        {/* Localhost / Development Origin Notice */}
        {isLocal && (
          <div className="p-3 bg-amber-950/30 border border-amber-800/50 rounded-lg flex items-start gap-2 text-xs text-amber-300/90 leading-relaxed">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-200">Local-Only Link Notice: </span>
              {LOCALHOST_ORIGIN_NOTICE}
            </div>
          </div>
        )}

        {/* Explanatory Footnote on Verification Scope */}
        <div className="p-3 bg-slate-950 border border-slate-800/80 rounded-lg flex items-start gap-2 text-[11px] text-slate-400 leading-relaxed">
          <Info className="w-4 h-4 text-indigo-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-slate-300">Live Registry Lookup: </span>
            {QR_LOOKUP_EXPLANATION}
          </div>
        </div>
      </div>
    </div>
  );
}
