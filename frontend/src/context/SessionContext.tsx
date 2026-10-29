'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { useAccount, useSignMessage, useDisconnect, useChainId } from 'wagmi';
import { SiweMessage } from 'siwe';
import { getClientEnv } from '@/lib/config/env';

export interface UserSession {
  authenticated: boolean;
  address?: string;
  chainId?: number;
  expiresAt?: string;
}

interface SessionContextType {
  session: UserSession | null;
  loading: boolean;
  error: string | null;
  signIn: () => Promise<boolean>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
}

const SessionContext = createContext<SessionContextType | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const { address, isConnected, status: accountStatus } = useAccount();
  const currentChainId = useChainId();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();

  // Active address ref to prevent race condition / delayed response restoring stale data
  const activeAddressRef = useRef<string | undefined>(address);
  useEffect(() => {
    activeAddressRef.current = address;
  }, [address]);

  // Account status ref to avoid recreating refreshSession unnecessarily while inspecting current status
  const accountStatusRef = useRef<string>(accountStatus);
  useEffect(() => {
    accountStatusRef.current = accountStatus;
  }, [accountStatus]);

  // Request counter to ensure stale/delayed responses never commit state after logout, disconnect, or account change
  const sessionRequestIdRef = useRef<number>(0);

  // Track whether an established connection has been observed in this page lifecycle
  const hasConnectedRef = useRef<boolean>(false);

  // Store server session returned during wallet hydration/reconnection until connector state resolves
  const pendingSessionRef = useRef<UserSession | null>(null);

  const refreshSession = useCallback(async () => {
    const reqId = ++sessionRequestIdRef.current;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/session', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' },
      });
      if (reqId !== sessionRequestIdRef.current) {
        return;
      }
      if (!res.ok) {
        pendingSessionRef.current = null;
        setSession({ authenticated: false });
        return;
      }
      const data: UserSession = await res.json();
      if (reqId !== sessionRequestIdRef.current) {
        return;
      }

      if (!data.authenticated) {
        pendingSessionRef.current = null;
        setSession({ authenticated: false });
        return;
      }

      // If wallet is still reconnecting/connecting during page hydration, hold session until connector resolves
      if (accountStatusRef.current === 'reconnecting' || accountStatusRef.current === 'connecting') {
        pendingSessionRef.current = data;
        return;
      }

      // If wallet is connected, verify address matches
      if (
        activeAddressRef.current &&
        data.address &&
        activeAddressRef.current.toLowerCase() === data.address.toLowerCase()
      ) {
        pendingSessionRef.current = null;
        setSession(data);
      } else {
        pendingSessionRef.current = null;
        setSession({ authenticated: false });
      }
    } catch {
      if (reqId === sessionRequestIdRef.current) {
        pendingSessionRef.current = null;
        setSession({ authenticated: false });
      }
    } finally {
      if (reqId === sessionRequestIdRef.current) {
        // If not holding a pending session waiting for hydration, conclude loading
        if (!pendingSessionRef.current) {
          setLoading(false);
        }
      }
    }
  }, []);

  // Check session on mount
  useEffect(() => {
    refreshSession();
  }, [refreshSession]);

  // Wallet hydration resolution and connection tracking
  useEffect(() => {
    if (isConnected && address) {
      hasConnectedRef.current = true;
      if (pendingSessionRef.current) {
        const pending = pendingSessionRef.current;
        pendingSessionRef.current = null;
        if (pending.address && address.toLowerCase() === pending.address.toLowerCase()) {
          setSession(pending);
        } else {
          setSession({ authenticated: false });
        }
        setLoading(false);
      }
    } else if (accountStatus === 'disconnected') {
      if (pendingSessionRef.current) {
        pendingSessionRef.current = null;
        setSession({ authenticated: false });
        setLoading(false);
      }
    }
  }, [address, isConnected, accountStatus]);

  // Genuine disconnect vs initial hydration handling:
  // An initial disconnected/reconnecting state during page load must NOT destroy a valid server session.
  // Only a genuine disconnect AFTER an established connection invalidates server session and private UI state.
  useEffect(() => {
    if (!isConnected) {
      if (hasConnectedRef.current) {
        // Genuine disconnect after an established connection!
        hasConnectedRef.current = false;
        sessionRequestIdRef.current++;
        pendingSessionRef.current = null;
        setSession({ authenticated: false });
        setLoading(false);

        fetch('/api/auth/logout', {
          method: 'POST',
          headers: { 'Cache-Control': 'no-store' },
        })
          .then((res) => {
            if (!res.ok) {
              setError('Failed to revoke server session. Local session was cleared.');
            }
          })
          .catch(() => {
            setError('Network error while revoking server session. Local session was cleared.');
          });
      }
      return;
    }

    if (address && session?.authenticated && session.address) {
      if (address.toLowerCase() !== session.address.toLowerCase()) {
        // Connected account changed while authenticated: clear active state
        sessionRequestIdRef.current++;
        pendingSessionRef.current = null;
        setLoading(false);
        console.warn('[AUTH] Wallet address mismatch with active session. Invalidating UI state.');
      }
    }
  }, [address, isConnected, session]);

  // Chain change handling: invalidate any active request and prevent stuck loading
  const prevChainIdRef = useRef<number>(currentChainId);
  useEffect(() => {
    if (prevChainIdRef.current !== currentChainId) {
      prevChainIdRef.current = currentChainId;
      sessionRequestIdRef.current++;
      pendingSessionRef.current = null;
      setLoading(false);
    }
  }, [currentChainId]);

  const signIn = useCallback(async (): Promise<boolean> => {
    setError(null);
    if (!isConnected || !address) {
      setError('Please connect your EVM wallet first.');
      return false;
    }

    const initiationAddress = address.toLowerCase();
    const reqId = ++sessionRequestIdRef.current;
    pendingSessionRef.current = null;

    try {
      setLoading(true);

      // 1. Fetch challenge nonce from server
      const nonceRes = await fetch('/api/auth/nonce', {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-store' },
      });

      if (reqId !== sessionRequestIdRef.current || activeAddressRef.current?.toLowerCase() !== initiationAddress) {
        throw new Error('Authentication aborted due to wallet or state change.');
      }

      if (!nonceRes.ok) {
        throw new Error('Failed to obtain authentication nonce from server.');
      }

      const { nonce } = await nonceRes.json();
      const clientEnv = getClientEnv();
      const domain = window.location.host;
      const origin = window.location.origin;

      // 2. Prepare SIWE message
      const siweMessage = new SiweMessage({
        domain,
        address,
        statement: 'Sign in to CertProof with Ethereum to access authorized issuer controls.',
        uri: origin,
        version: '1',
        chainId: clientEnv.NEXT_PUBLIC_CHAIN_ID,
        nonce,
        issuedAt: new Date().toISOString(),
      });

      const messageToSign = siweMessage.prepareMessage();

      // 3. Request wallet signature
      const signature = await signMessageAsync({
        message: messageToSign,
      });

      // Guard: Abort if user switched wallets while signature popup was open
      if (reqId !== sessionRequestIdRef.current || activeAddressRef.current?.toLowerCase() !== initiationAddress) {
        throw new Error('Active wallet account changed during signing. Authentication aborted.');
      }

      // 4. Verify signature on backend
      const verifyRes = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
        body: JSON.stringify({
          message: messageToSign,
          signature,
        }),
      });

      if (reqId !== sessionRequestIdRef.current || activeAddressRef.current?.toLowerCase() !== initiationAddress) {
        throw new Error('Active wallet account changed post-verification.');
      }

      const verifyData = await verifyRes.json();

      if (!verifyRes.ok || !verifyData.ok) {
        throw new Error(verifyData.error || 'Authentication signature verification failed.');
      }

      // 5. Final guard against race condition
      if (reqId !== sessionRequestIdRef.current || activeAddressRef.current?.toLowerCase() !== initiationAddress) {
        throw new Error('Active wallet account changed post-verification.');
      }

      setSession({
        authenticated: true,
        address: verifyData.address,
        chainId: verifyData.chainId,
      });

      return true;
    } catch (err: unknown) {
      if (reqId === sessionRequestIdRef.current) {
        const errMsg = err instanceof Error ? err.message : 'Unknown sign-in error';
        setError(errMsg);
      }
      return false;
    } finally {
      if (reqId === sessionRequestIdRef.current) {
        setLoading(false);
      }
    }
  }, [address, isConnected, signMessageAsync]);

  const logout = useCallback(async () => {
    sessionRequestIdRef.current++;
    pendingSessionRef.current = null;
    hasConnectedRef.current = false;
    let logoutFailed = false;

    try {
      setLoading(true);
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Cache-Control': 'no-store' },
      });
      if (!res.ok) {
        logoutFailed = true;
      }
    } catch (err) {
      logoutFailed = true;
      console.error('[LOGOUT_ERROR]', err);
    } finally {
      setSession({ authenticated: false });
      disconnect();
      setLoading(false);
      if (logoutFailed) {
        setError('Failed to revoke server session. Local session was cleared.');
      }
    }
  }, [disconnect]);

  return (
    <SessionContext.Provider
      value={{
        session,
        loading,
        error,
        signIn,
        logout,
        refreshSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
