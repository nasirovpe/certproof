import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getClientEnv, getServerEnv } from '@/lib/config/env';
import { CertProofRegistryABI } from '@/lib/abi/CertProofRegistry';
import { createPublicClient, http } from 'viem';
import { sepolia } from 'viem/chains';
import { anvilChain } from '@/lib/config/chains';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  // 1. Enforce Server Session Authentication
  const rawToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const session = await getSession(rawToken);

  if (!session) {
    return NextResponse.json(
      { error: 'Unauthorized: Valid server session required.' },
      {
        status: 401,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
      }
    );
  }

  const serverEnv = getServerEnv();
  const clientEnv = getClientEnv();
  const targetChain = clientEnv.NEXT_PUBLIC_CHAIN_ID === 11155111 ? sepolia : anvilChain;
  const rpcUrl = serverEnv.SERVER_RPC_URL || (
    clientEnv.NEXT_PUBLIC_CHAIN_ID === 11155111
      ? (clientEnv.NEXT_PUBLIC_SEPOLIA_RPC_URL || 'https://rpc.sepolia.org')
      : (clientEnv.NEXT_PUBLIC_ANVIL_RPC_URL || 'http://127.0.0.1:8545')
  );

  // 2. Query On-Chain Authorization
  try {
    const publicClient = createPublicClient({
      chain: targetChain,
      transport: http(rpcUrl, { timeout: 4000 }),
    });

    // Check if contract has bytecode at configured address
    const code = await publicClient.getBytecode({ address: clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS });
    if (!code || code === '0x') {
      return NextResponse.json(
        {
          authenticated: true,
          walletAddress: session.walletAddress,
          registryAddress: clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS,
          contractDeployed: false,
          isAuthorized: false,
          error: 'MISSING_DEPLOYMENT',
          message: `No contract code deployed at configured address ${clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS}.`,
        },
        {
          status: 200,
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
        }
      );
    }

    const isAuthorized = await publicClient.readContract({
      address: clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS,
      abi: CertProofRegistryABI,
      functionName: 'isIssuerAuthorized',
      args: [session.walletAddress as `0x${string}`],
    });

    return NextResponse.json(
      {
        authenticated: true,
        walletAddress: session.walletAddress,
        registryAddress: clientEnv.NEXT_PUBLIC_REGISTRY_ADDRESS,
        chainId: clientEnv.NEXT_PUBLIC_CHAIN_ID,
        contractDeployed: true,
        isAuthorized: Boolean(isAuthorized),
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
      }
    );
  } catch (err) {
    // Explicitly distinguish RPC transport error from "Unauthorized"
    console.error('[ISSUER_STATUS_RPC_ERROR]', err instanceof Error ? err.message : 'Unknown RPC error');
    return NextResponse.json(
      {
        authenticated: true,
        walletAddress: session.walletAddress,
        error: 'RPC_ERROR',
        message: 'Ethereum node unreachable or timed out while querying issuer authorization. Do not interpret as unauthorized.',
      },
      {
        status: 503,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
      }
    );
  }
}
