import type { Metadata } from 'next';
import './globals.css';
import { Providers } from '@/components/Providers';
import { NetworkNotice } from '@/components/NetworkNotice';
import Link from 'next/link';
import { WalletConnect } from '@/components/WalletConnect';

export const metadata: Metadata = {
  title: 'CertProof — Decentralized Credential Verification',
  description: 'Privacy-preserving cryptographic credential verification on Ethereum.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-slate-950 text-slate-100 flex flex-col min-h-screen">
        <Providers>
          {/* Persistent Testnet / Development Notice */}
          <NetworkNotice />

          {/* Navigation Bar */}
          <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur-md sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
              <div className="flex items-center gap-6">
                <Link href="/" className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center font-bold text-white text-lg shadow-lg shadow-indigo-500/20">
                    C
                  </div>
                  <span className="font-bold text-lg tracking-tight text-white">
                    Cert<span className="text-indigo-400">Proof</span>
                  </span>
                </Link>

                <nav className="hidden md:flex items-center gap-4 text-sm font-medium text-slate-300">
                  <Link href="/" className="hover:text-white transition-colors">
                    Home
                  </Link>
                  <Link href="/verify" className="hover:text-white transition-colors">
                    Verify Document
                  </Link>
                  <Link href="/issuer" className="hover:text-white transition-colors">
                    Issuer Portal
                  </Link>
                </nav>
              </div>

              <div>
                <WalletConnect />
              </div>
            </div>
          </header>

          {/* Main Content */}
          <main className="flex-1 flex flex-col">{children}</main>

          {/* Footer */}
          <footer className="border-t border-slate-800/80 bg-slate-900/30 py-6 text-xs text-slate-500 text-center">
            <div className="max-w-7xl mx-auto px-4">
              CertProof — Open-source zero-tamper credential verification on Ethereum. Never stores PII or student data.
            </div>
          </footer>
        </Providers>
      </body>
    </html>
  );
}
