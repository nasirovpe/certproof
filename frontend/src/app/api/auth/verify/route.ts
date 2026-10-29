import { NextRequest, NextResponse } from 'next/server';
import { verifySiweChallenge, SIWE_BINDING_COOKIE } from '@/lib/auth/siwe';
import { createSession, SESSION_COOKIE_NAME, getSessionCookieOptions } from '@/lib/auth/session';
import { checkRateLimit } from '@/lib/auth/rate-limit';
import { resolveClientIp } from '@/lib/auth/ip';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ip = resolveClientIp(request);
  const rateLimit = checkRateLimit(`verify:${ip}`, 20, 60_000);

  if (!rateLimit.success) {
    return NextResponse.json(
      { ok: false, error: 'Rate limit exceeded. Please wait a moment.' },
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
    const body = await request.json();
    const { message, signature } = body || {};

    const browserBindingToken = request.cookies.get(SIWE_BINDING_COOKIE)?.value;
    const priorSessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    const requestOrigin = request.headers.get('origin') || request.headers.get('referer') || undefined;

    const verification = await verifySiweChallenge({
      message,
      signature,
      browserBindingToken,
      requestOrigin,
    });

    if (!verification.success || !verification.address || !verification.chainId) {
      return NextResponse.json(
        { ok: false, error: verification.error, code: verification.errorCode },
        {
          status: 401,
          headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
        }
      );
    }

    const userAgent = request.headers.get('user-agent') || undefined;
    const newSession = await createSession(
      verification.address,
      verification.chainId,
      priorSessionToken,
      userAgent
    );

    const response = NextResponse.json(
      {
        ok: true,
        address: newSession.walletAddress,
        chainId: newSession.chainId,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate, private' },
      }
    );

    // Set new rotated session cookie
    response.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: newSession.token,
      ...getSessionCookieOptions(newSession.expiresAt),
    });

    // Clear single-use browser binding cookie
    response.cookies.delete(SIWE_BINDING_COOKIE);

    return response;
  } catch (err) {
    console.error('[AUTH_VERIFY_ERROR]', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json(
      { ok: false, error: 'Internal verification failure.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
