import { NextRequest, NextResponse } from 'next/server';
import { destroySession, SESSION_COOKIE_NAME } from '@/lib/auth/session';
import { getClientEnv } from '@/lib/config/env';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  // CSRF validation on logout
  const clientEnv = getClientEnv();
  const expectedHost = new URL(clientEnv.NEXT_PUBLIC_APP_URL).host;
  const origin = request.headers.get('origin') || request.headers.get('referer');

  if (origin) {
    try {
      const originHost = new URL(origin).host;
      if (originHost !== expectedHost) {
        return NextResponse.json(
          { ok: false, error: 'Cross-origin request rejected.' },
          {
            status: 403,
            headers: { 'Cache-Control': 'no-store' },
          }
        );
      }
    } catch {
      return NextResponse.json(
        { ok: false, error: 'Invalid origin header.' },
        { status: 400 }
      );
    }
  }

  try {
    const rawToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    await destroySession(rawToken);

    const response = NextResponse.json(
      { ok: true },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        },
      }
    );

    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  } catch (err) {
    console.error('[AUTH_LOGOUT_ERROR]', err instanceof Error ? err.message : 'Unknown error');
    return NextResponse.json(
      { ok: false, error: 'Logout error.' },
      {
        status: 500,
        headers: { 'Cache-Control': 'no-store' },
      }
    );
  }
}
