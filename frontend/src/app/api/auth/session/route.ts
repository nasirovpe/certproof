import { NextRequest, NextResponse } from 'next/server';
import { getSession, SESSION_COOKIE_NAME } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const rawToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const session = await getSession(rawToken);

    if (!session) {
      return NextResponse.json(
        { authenticated: false },
        {
          status: 200,
          headers: {
            'Cache-Control': 'no-store, no-cache, must-revalidate, private',
          },
        }
      );
    }

    return NextResponse.json(
      {
        authenticated: true,
        address: session.walletAddress,
        chainId: session.chainId,
        expiresAt: session.expiresAt.toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        },
      }
    );
  } catch (err) {
    console.error('[AUTH_SESSION_ERROR]', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json(
      { authenticated: false, error: 'Failed to inspect session.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
