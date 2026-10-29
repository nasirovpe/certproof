import { NextRequest, NextResponse } from 'next/server';
import { createSiweChallenge, SIWE_BINDING_COOKIE } from '@/lib/auth/siwe';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { resolveClientIp } from '@/lib/auth/ip';
import { getClientEnv } from '@/lib/config/env';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const ip = resolveClientIp(request);
  const rateLimit = checkRateLimit(`nonce:${ip}`, 30, 60_000);

  if (!rateLimit.success) {
    return NextResponse.json(
      { error: 'Rate limit exceeded. Please wait a moment.' },
      {
        status: 429,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
          'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
        },
      }
    );
  }

  try {
    const clientEnv = getClientEnv();
    const challenge = await createSiweChallenge(clientEnv.NEXT_PUBLIC_CHAIN_ID);

    const isProd = process.env.NODE_ENV === 'production';
    const secure = process.env.COOKIE_SECURE !== undefined
      ? (process.env.COOKIE_SECURE === 'true' || process.env.COOKIE_SECURE === '1')
      : isProd;
    const response = NextResponse.json(
      { nonce: challenge.nonce },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        },
      }
    );

    // Bind challenge to this browser session
    response.cookies.set({
      name: SIWE_BINDING_COOKIE,
      value: challenge.browserBindingToken,
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      expires: challenge.expiresAt,
    });

    return response;
  } catch (err) {
    console.error('[AUTH_NONCE_ERROR]', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json(
      { error: 'Failed to generate authentication challenge.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
