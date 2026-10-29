// @vitest-environment happy-dom
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import { SessionProvider, useSession } from '@/context/SessionContext';
import IssuerPage from '@/app/issuer/page';

// Mock wagmi hooks so test controls account, chainId, and connection state dynamically
let mockAccountState = {
  address: '0x1111111111111111111111111111111111111111' as string | undefined,
  isConnected: true,
  status: 'connected',
};
let mockChainId = 31337;
const mockDisconnect = vi.fn(() => {
  mockAccountState.isConnected = false;
  mockAccountState.address = undefined;
  mockAccountState.status = 'disconnected';
});
const mockSignMessageAsync = vi.fn().mockResolvedValue('0xvalidsig');

vi.mock('wagmi', () => ({
  createConfig: vi.fn(),
  http: vi.fn(),
  useAccount: () => mockAccountState,
  useChainId: () => mockChainId,
  useDisconnect: () => ({ disconnect: mockDisconnect }),
  useSignMessage: () => ({ signMessageAsync: mockSignMessageAsync }),
  useConnect: () => ({
    connectors: [{ type: 'injected', name: 'Injected' }],
    connect: vi.fn(),
    isPending: false,
    error: null,
  }),
  useSwitchChain: () => ({
    switchChain: vi.fn(),
    isPending: false,
  }),
  useWriteContract: () => ({
    writeContractAsync: vi.fn(),
    isPending: false,
  }),
  usePublicClient: () => undefined,
}));

// Mock client env
vi.mock('@/lib/config/env', () => ({
  getClientEnv: () => ({
    NEXT_PUBLIC_APP_URL: 'http://localhost:3000',
    NEXT_PUBLIC_CHAIN_ID: 31337,
    NEXT_PUBLIC_REGISTRY_ADDRESS: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
    NEXT_PUBLIC_ANVIL_RPC_URL: 'http://127.0.0.1:8545',
  }),
}));

const ACCOUNT_A = '0x1111111111111111111111111111111111111111';
const ACCOUNT_B = '0x2222222222222222222222222222222222222222';

describe('Wallet and Session State Invalidation Suite', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    mockAccountState = {
      address: ACCOUNT_A,
      isConnected: true,
      status: 'connected',
    };
    mockChainId = 31337;
    mockDisconnect.mockClear();
    mockSignMessageAsync.mockClear();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('1. Account switching: private content disappears immediately when switching from Account A to Account B', async () => {
    // Mock /api/auth/session to return active session for Account A
    // Mock /api/issuer/status to return authorized for Account A
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            address: ACCOUNT_A,
            chainId: 31337,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        } as Response;
      }
      if (urlStr.includes('/api/issuer/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            walletAddress: ACCOUNT_A,
            registryAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
            contractDeployed: true,
            isAuthorized: true,
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const { rerender } = render(
      <SessionProvider>
        <IssuerPage />
      </SessionProvider>
    );

    // Initial state: Account A is authenticated and authorized
    await waitFor(() => {
      expect(screen.getByText('Authorized Registry Issuer')).toBeDefined();
      expect(screen.getByText(ACCOUNT_A)).toBeDefined();
    });

    // Switch account to Account B
    mockAccountState = {
      address: ACCOUNT_B,
      isConnected: true,
      status: 'connected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <IssuerPage />
        </SessionProvider>
      );
    });

    // Assert: Private content disappears immediately
    expect(screen.queryByText('Authorized Registry Issuer')).toBeNull();
    // Mismatch state is displayed
    expect(screen.getByText(/Wallet \/ Session Mismatch Detected/i)).toBeDefined();
    expect(screen.getByText(/The active browser session belongs to/i)).toBeDefined();
  });

  it('2. Chain change: private content disappears immediately upon switching to an unsupported network', async () => {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            address: ACCOUNT_A,
            chainId: 31337,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        } as Response;
      }
      if (urlStr.includes('/api/issuer/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            walletAddress: ACCOUNT_A,
            registryAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
            contractDeployed: true,
            isAuthorized: true,
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const { rerender } = render(
      <SessionProvider>
        <IssuerPage />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Authorized Registry Issuer')).toBeDefined();
    });

    // Switch chain to unsupported network (e.g. Ethereum Mainnet chainId 1)
    mockChainId = 1;

    act(() => {
      rerender(
        <SessionProvider>
          <IssuerPage />
        </SessionProvider>
      );
    });

    // Assert: Private content disappears immediately and unsupported network banner is shown
    expect(screen.queryByText('Authorized Registry Issuer')).toBeNull();
    expect(screen.queryByText('Active Authenticated Session')).toBeNull();
    expect(screen.getByText(/Unsupported Network/i)).toBeDefined();
    expect(screen.getByText(/Your wallet is currently connected to Chain ID/i)).toBeDefined();
  });

  it('3. Wallet disconnect: private content disappears immediately and unauthenticated state is restored', async () => {
    let logoutCalled = false;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            address: ACCOUNT_A,
            chainId: 31337,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        } as Response;
      }
      if (urlStr.includes('/api/issuer/status')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            walletAddress: ACCOUNT_A,
            registryAddress: '0x5fbdb2315678afecb367f032d93f642f64180aa3',
            contractDeployed: true,
            isAuthorized: true,
          }),
        } as Response;
      }
      if (urlStr.includes('/api/auth/logout')) {
        logoutCalled = true;
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const { rerender } = render(
      <SessionProvider>
        <IssuerPage />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Authorized Registry Issuer')).toBeDefined();
    });

    // Disconnect wallet
    mockAccountState = {
      address: undefined,
      isConnected: false,
      status: 'disconnected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <IssuerPage />
        </SessionProvider>
      );
    });

    // Assert: Private content disappears immediately and "Wallet Disconnected" is rendered
    expect(screen.queryByText('Authorized Registry Issuer')).toBeNull();
    expect(screen.getByText('Wallet Disconnected')).toBeDefined();
    expect(screen.getByText(/Connect an authorized institution wallet/i)).toBeDefined();

    // Verify background session logout was dispatched
    await waitFor(() => {
      expect(logoutCalled).toBe(true);
    });
  });

  it('4. Reconnecting wallet does NOT automatically authenticate it', async () => {
    // Initial state: Wallet is disconnected, server has no active session
    mockAccountState = {
      address: undefined,
      isConnected: false,
      status: 'disconnected',
    };

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ authenticated: false }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const { rerender } = render(
      <SessionProvider>
        <IssuerPage />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Wallet Disconnected')).toBeDefined();
    });

    // User reconnects wallet (e.g. Account A connects)
    mockAccountState = {
      address: ACCOUNT_A,
      isConnected: true,
      status: 'connected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <IssuerPage />
        </SessionProvider>
      );
    });

    // Assert: Connecting does NOT authenticate the wallet
    expect(screen.queryByText('Authorized Registry Issuer')).toBeNull();
    expect(screen.queryByText('Active Authenticated Session')).toBeNull();
    expect(screen.getByText('Wallet Connected — Authentication Required')).toBeDefined();
    expect(screen.getByText(/Connecting a wallet does not authenticate you/i)).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText('Sign In with Ethereum (SIWE)')).toBeDefined();
    });
  });

  it('5. Logout and session expiration: immediately clears private content and invalidates session', async () => {
    let sessionAuthenticated = true;
    let logoutInvoked = false;

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: sessionAuthenticated,
            address: sessionAuthenticated ? ACCOUNT_A : undefined,
          }),
        } as Response;
      }
      if (urlStr.includes('/api/issuer/status')) {
        if (!sessionAuthenticated) {
          return { ok: false, status: 401, json: async () => ({ error: 'Unauthorized' }) } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            walletAddress: ACCOUNT_A,
            contractDeployed: true,
            isAuthorized: true,
          }),
        } as Response;
      }
      if (urlStr.includes('/api/auth/logout')) {
        logoutInvoked = true;
        sessionAuthenticated = false;
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestComponent() {
      const { logout } = useSession();
      return (
        <div>
          <button onClick={() => logout()}>Trigger Sign Out</button>
          <IssuerPage />
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestComponent />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByText('Authorized Registry Issuer')).toBeDefined();
    });

    // Trigger logout
    await act(async () => {
      screen.getByText('Trigger Sign Out').click();
    });

    // Assert: Logout endpoint called, disconnect invoked, private content gone
    expect(logoutInvoked).toBe(true);
    expect(mockDisconnect).toHaveBeenCalled();
    expect(screen.queryByText('Authorized Registry Issuer')).toBeNull();
  });

  it('6. Delayed response for Account A arriving after switching to Account B is discarded and cannot restore private content', async () => {
    let resolveAccountAStatus!: (value: Response) => void;
    const accountAPromise = new Promise<Response>((resolve) => {
      resolveAccountAStatus = resolve;
    });

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            address: ACCOUNT_A,
            chainId: 31337,
          }),
        } as Response;
      }
      if (urlStr.includes('/api/issuer/status')) {
        // Return unresolved promise simulating network lag
        return accountAPromise;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    const { rerender } = render(
      <SessionProvider>
        <IssuerPage />
      </SessionProvider>
    );

    // Initial state: Request is in flight for Account A
    await waitFor(() => {
      expect(screen.getByText(/Checking Registry/i)).toBeDefined();
    });

    // While request is in-flight, user switches wallet to Account B
    mockAccountState = {
      address: ACCOUNT_B,
      isConnected: true,
      status: 'connected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <IssuerPage />
        </SessionProvider>
      );
    });

    // Private content is not shown (mismatch state)
    expect(screen.getByText(/Wallet \/ Session Mismatch Detected/i)).toBeDefined();

    // Now delayed response for Account A resolves
    await act(async () => {
      resolveAccountAStatus({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          walletAddress: ACCOUNT_A,
          contractDeployed: true,
          isAuthorized: true,
        }),
      } as Response);
    });

    // Assert: Delayed response was DISCARDED. Private content is NOT rendered!
    expect(screen.queryByText('Authorized Registry Issuer')).toBeNull();
    expect(screen.getByText(/Wallet \/ Session Mismatch Detected/i)).toBeDefined();
  });

  it('7. Delayed authenticated response arriving after logout or disconnect is discarded and cannot restore session', async () => {
    let resolvePendingSession!: (value: Response) => void;
    const pendingSessionPromise = new Promise<Response>((resolve) => {
      resolvePendingSession = resolve;
    });

    // refreshSession starts with pending promise
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return pendingSessionPromise;
      }
      if (urlStr.includes('/api/auth/logout')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestComponent() {
      const { session, logout } = useSession();
      return (
        <div>
          <span data-testid="auth-state">{session?.authenticated ? 'AUTHENTICATED' : 'NOT_AUTHENTICATED'}</span>
          <button onClick={() => logout()}>Sign Out</button>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestComponent />
      </SessionProvider>
    );

    // While request is in flight, user logs out
    await act(async () => {
      screen.getByText('Sign Out').click();
    });

    expect(screen.getByTestId('auth-state').textContent).toBe('NOT_AUTHENTICATED');

    // Now delayed response arrives claiming valid session
    await act(async () => {
      resolvePendingSession({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          address: ACCOUNT_A,
          chainId: 31337,
        }),
      } as Response);
    });

    // Assert: Delayed response was ignored and cannot resurrect the authenticated session
    expect(screen.getByTestId('auth-state').textContent).toBe('NOT_AUTHENTICATED');
  });

  // --- SECTION 1: Controlled Overlapping Session Requests (Item 1) ---

  it('8. Overlapping requests: A succeeds while B is pending; A cannot clear loading or overwrite B; B finishes and resolves correctly', async () => {
    let resolveA!: (value: Response) => void;
    const promiseA = new Promise<Response>((resolve) => { resolveA = resolve; });

    let resolveB!: (value: Response) => void;
    const promiseB = new Promise<Response>((resolve) => { resolveB = resolve; });

    let callCount = 0;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        callCount++;
        if (callCount === 1) return promiseA;
        if (callCount === 2) return promiseB;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, loading, refreshSession } = useSession();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <span data-testid="addr">{session?.address ?? ''}</span>
          <button data-testid="refresh-btn" onClick={() => refreshSession()}>Refresh</button>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    // Initial mount starts Request A (call #1)
    expect(callCount).toBe(1);
    expect(screen.getByTestId('loading').textContent).toBe('true');

    // Trigger Request B while Request A is pending (call #2)
    act(() => {
      screen.getByTestId('refresh-btn').click();
    });
    expect(callCount).toBe(2);
    expect(screen.getByTestId('loading').textContent).toBe('true');

    // Request A finishes with success while Request B is still pending
    await act(async () => {
      resolveA({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          address: ACCOUNT_A,
          chainId: 31337,
        }),
      } as Response);
    });

    // Verification: Loading remains TRUE; Request A did NOT clear loading and did NOT commit state
    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('auth').textContent).toBe('false');

    // Request B finishes with success
    await act(async () => {
      resolveB({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          address: ACCOUNT_A,
          chainId: 31337,
        }),
      } as Response);
    });

    // Verification: Loading resolves to FALSE; Request B commits state correctly
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('addr').textContent).toBe(ACCOUNT_A);
  });

  it('9. Overlapping requests: A fails while B is pending; A cannot clear loading or overwrite B; B finishes and succeeds', async () => {
    let rejectA!: (reason?: unknown) => void;
    const promiseA = new Promise<Response>((_, reject) => { rejectA = reject; });

    let resolveB!: (value: Response) => void;
    const promiseB = new Promise<Response>((resolve) => { resolveB = resolve; });

    let callCount = 0;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        callCount++;
        if (callCount === 1) return promiseA;
        if (callCount === 2) return promiseB;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, loading, refreshSession } = useSession();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <button data-testid="refresh-btn" onClick={() => refreshSession()}>Refresh</button>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    expect(callCount).toBe(1);

    // Trigger Request B
    act(() => {
      screen.getByTestId('refresh-btn').click();
    });
    expect(callCount).toBe(2);
    expect(screen.getByTestId('loading').textContent).toBe('true');

    // Request A fails while Request B is pending
    await act(async () => {
      rejectA(new Error('Network transport dropped'));
    });

    // Verification: Loading remains TRUE; A's error did NOT clear loading
    expect(screen.getByTestId('loading').textContent).toBe('true');

    // Request B succeeds
    await act(async () => {
      resolveB({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          address: ACCOUNT_A,
          chainId: 31337,
        }),
      } as Response);
    });

    // Verification: Loading resolves to FALSE; B commits authenticated state
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('auth').textContent).toBe('true');
  });

  it('10. Overlapping requests: A succeeds while B is pending; B fails; loading resolves to false and B unauthenticated state commits', async () => {
    let resolveA!: (value: Response) => void;
    const promiseA = new Promise<Response>((resolve) => { resolveA = resolve; });

    let rejectB!: (reason?: unknown) => void;
    const promiseB = new Promise<Response>((_, reject) => { rejectB = reject; });

    let callCount = 0;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        callCount++;
        if (callCount === 1) return promiseA;
        if (callCount === 2) return promiseB;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, loading, refreshSession } = useSession();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <button data-testid="refresh-btn" onClick={() => refreshSession()}>Refresh</button>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    act(() => {
      screen.getByTestId('refresh-btn').click();
    });

    // Request A succeeds while B is pending
    await act(async () => {
      resolveA({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          address: ACCOUNT_A,
          chainId: 31337,
        }),
      } as Response);
    });

    // A's success must not commit or clear loading
    expect(screen.getByTestId('loading').textContent).toBe('true');
    expect(screen.getByTestId('auth').textContent).toBe('false');

    // Request B fails
    await act(async () => {
      rejectB(new Error('Session validation failed'));
    });

    // Loading resolves to false; B's unauthenticated state is committed
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('auth').textContent).toBe('false');
  });

  it('11. Overlapping requests: A fails while B is pending; B fails; loading resolves correctly', async () => {
    let rejectA!: (reason?: unknown) => void;
    const promiseA = new Promise<Response>((_, reject) => { rejectA = reject; });

    let rejectB!: (reason?: unknown) => void;
    const promiseB = new Promise<Response>((_, reject) => { rejectB = reject; });

    let callCount = 0;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        callCount++;
        if (callCount === 1) return promiseA;
        if (callCount === 2) return promiseB;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, loading, refreshSession } = useSession();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <button data-testid="refresh-btn" onClick={() => refreshSession()}>Refresh</button>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    act(() => {
      screen.getByTestId('refresh-btn').click();
    });

    await act(async () => {
      rejectA(new Error('A failed'));
    });
    expect(screen.getByTestId('loading').textContent).toBe('true');

    await act(async () => {
      rejectB(new Error('B failed'));
    });
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('auth').textContent).toBe('false');
  });

  it('12. Overlapping requests (reverse order): B completes before A; B commits and delayed A cannot alter state', async () => {
    let resolveA!: (value: Response) => void;
    const promiseA = new Promise<Response>((resolve) => { resolveA = resolve; });

    let resolveB!: (value: Response) => void;
    const promiseB = new Promise<Response>((resolve) => { resolveB = resolve; });

    let callCount = 0;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        callCount++;
        if (callCount === 1) return promiseA;
        if (callCount === 2) return promiseB;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, loading, refreshSession } = useSession();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <span data-testid="addr">{session?.address ?? ''}</span>
          <button data-testid="refresh-btn" onClick={() => refreshSession()}>Refresh</button>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    act(() => {
      screen.getByTestId('refresh-btn').click();
    });

    // B completes FIRST
    await act(async () => {
      resolveB({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: true,
          address: ACCOUNT_A,
          chainId: 31337,
        }),
      } as Response);
    });

    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('addr').textContent).toBe(ACCOUNT_A);

    // A finishes LATER with different or unauthenticated data
    await act(async () => {
      resolveA({
        ok: true,
        status: 200,
        json: async () => ({
          authenticated: false,
        }),
      } as Response);
    });

    // Verification: A was discarded; state and loading remain B's resolved state
    expect(screen.getByTestId('loading').textContent).toBe('false');
    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('addr').textContent).toBe(ACCOUNT_A);
  });

  it('13. Cancellation, disconnect, and account/chain changes do not leave loading stuck', async () => {
    let resolveSession!: (value: Response) => void;
    const pendingPromise = new Promise<Response>((resolve) => { resolveSession = resolve; });

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return pendingPromise;
      }
      if (urlStr.includes('/api/auth/logout')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { loading } = useSession();
      return <span data-testid="loading">{String(loading)}</span>;
    }

    const { rerender } = render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    // Request is in-flight: loading is true
    expect(screen.getByTestId('loading').textContent).toBe('true');

    // Wallet disconnects while request is in-flight
    mockAccountState = {
      address: undefined,
      isConnected: false,
      status: 'disconnected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <TestHarness />
        </SessionProvider>
      );
    });

    // Assert: Loading is immediately reset to false (NOT stuck!)
    expect(screen.getByTestId('loading').textContent).toBe('false');

    // Delayed response finally resolves
    await act(async () => {
      resolveSession({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, address: ACCOUNT_A }),
      } as Response);
    });

    // Loading remains false
    expect(screen.getByTestId('loading').textContent).toBe('false');
  });

  // --- SECTION 2: Distinguish Wallet Hydration from Actual Disconnect (Item 2) ---

  it('14. Initial wallet hydration: reconnecting state during page load preserves server session and does NOT trigger server logout', async () => {
    let logoutCallCount = 0;

    // Wagmi starts in reconnecting status (page loading / hydration)
    mockAccountState = {
      address: undefined,
      isConnected: false,
      status: 'reconnecting',
    };

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            address: ACCOUNT_A,
            chainId: 31337,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        } as Response;
      }
      if (urlStr.includes('/api/auth/logout')) {
        logoutCallCount++;
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, loading } = useSession();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <span data-testid="addr">{session?.address ?? ''}</span>
        </div>
      );
    }

    const { rerender } = render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    // During hydration, server session was NOT destroyed
    await waitFor(() => {
      expect(logoutCallCount).toBe(0);
    });

    // Hydration completes: connector connects with matching address
    mockAccountState = {
      address: ACCOUNT_A,
      isConnected: true,
      status: 'connected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <TestHarness />
        </SessionProvider>
      );
    });

    // Assert: Session is restored successfully upon wallet hydration!
    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('addr').textContent).toBe(ACCOUNT_A);
    expect(screen.getByTestId('loading').textContent).toBe('false');
    // Ensure server logout was NEVER called during page load hydration
    expect(logoutCallCount).toBe(0);
  });

  it('15. Same-wallet refresh: page refresh with already-connected wallet restores valid session immediately', async () => {
    mockAccountState = {
      address: ACCOUNT_A,
      isConnected: true,
      status: 'connected',
    };

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            address: ACCOUNT_A,
            chainId: 31337,
            expiresAt: new Date(Date.now() + 3600000).toISOString(),
          }),
        } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, loading } = useSession();
      return (
        <div>
          <span data-testid="loading">{String(loading)}</span>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <span data-testid="addr">{session?.address ?? ''}</span>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('loading').textContent).toBe('false');
      expect(screen.getByTestId('auth').textContent).toBe('true');
      expect(screen.getByTestId('addr').textContent).toBe(ACCOUNT_A);
    });
  });

  it('16. Explicit disconnect triggers server logout; reconnecting requires fresh authentication', async () => {
    let logoutCallCount = 0;
    let sessionAuthenticatedOnServer = true;

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: sessionAuthenticatedOnServer,
            address: sessionAuthenticatedOnServer ? ACCOUNT_A : undefined,
          }),
        } as Response;
      }
      if (urlStr.includes('/api/auth/logout')) {
        logoutCallCount++;
        sessionAuthenticatedOnServer = false;
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session } = useSession();
      return (
        <div>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <IssuerPage />
        </div>
      );
    }

    const { rerender } = render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    // Initial state: connected and authenticated
    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('true');
    });

    // User disconnects wallet (genuine disconnect)
    mockAccountState = {
      address: undefined,
      isConnected: false,
      status: 'disconnected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <TestHarness />
        </SessionProvider>
      );
    });

    // Verification: Private UI cleared immediately and server logout dispatched
    expect(screen.getByTestId('auth').textContent).toBe('false');
    await waitFor(() => {
      expect(logoutCallCount).toBe(1);
    });

    // User reconnects the same wallet
    mockAccountState = {
      address: ACCOUNT_A,
      isConnected: true,
      status: 'connected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <TestHarness />
        </SessionProvider>
      );
    });

    // Verification: Reconnecting does NOT authenticate the wallet
    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByText('Wallet Connected — Authentication Required')).toBeDefined();
    expect(screen.getByText(/Connecting a wallet does not authenticate you/i)).toBeDefined();
  });

  it('17. Logout failure handling: if server logout fails, private UI remains cleared and recoverable error is exposed', async () => {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            authenticated: true,
            address: ACCOUNT_A,
            chainId: 31337,
          }),
        } as Response;
      }
      if (urlStr.includes('/api/auth/logout')) {
        // Server logout returns 500 error
        return { ok: false, status: 500, json: async () => ({ error: 'Internal server error' }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, error, logout } = useSession();
      return (
        <div>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <span data-testid="err">{error ?? ''}</span>
          <button data-testid="logout-btn" onClick={() => logout()}>Sign Out</button>
        </div>
      );
    }

    render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId('auth').textContent).toBe('true');
    });

    // Trigger logout
    await act(async () => {
      screen.getByTestId('logout-btn').click();
    });

    // Verification:
    // 1. Private UI remains cleared (authenticated = false)
    expect(screen.getByTestId('auth').textContent).toBe('false');
    // 2. Recoverable error is exposed to the user
    expect(screen.getByTestId('err').textContent).toContain('Failed to revoke server session');
    // 3. Wallet disconnect was called
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it('18. Hydration and delayed response races cannot restore stale authentication after logout', async () => {
    let resolveSessionQuery!: (value: Response) => void;
    const sessionPromise = new Promise<Response>((resolve) => { resolveSessionQuery = resolve; });

    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.includes('/api/auth/session')) {
        return sessionPromise;
      }
      if (urlStr.includes('/api/auth/logout')) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });

    function TestHarness() {
      const { session, logout } = useSession();
      return (
        <div>
          <span data-testid="auth">{String(session?.authenticated ?? false)}</span>
          <button data-testid="logout-btn" onClick={() => logout()}>Sign Out</button>
        </div>
      );
    }

    const { rerender } = render(
      <SessionProvider>
        <TestHarness />
      </SessionProvider>
    );

    // User triggers logout while session query is pending
    await act(async () => {
      screen.getByTestId('logout-btn').click();
    });

    expect(screen.getByTestId('auth').textContent).toBe('false');

    // Wagmi updates or delayed session response arrives claiming valid session
    await act(async () => {
      resolveSessionQuery({
        ok: true,
        status: 200,
        json: async () => ({ authenticated: true, address: ACCOUNT_A }),
      } as Response);
    });

    // Simulate subsequent hydration event
    mockAccountState = {
      address: ACCOUNT_A,
      isConnected: true,
      status: 'connected',
    };

    act(() => {
      rerender(
        <SessionProvider>
          <TestHarness />
        </SessionProvider>
      );
    });

    // Assert: Session remains NOT authenticated! Race cannot restore stale session
    expect(screen.getByTestId('auth').textContent).toBe('false');
  });
});
