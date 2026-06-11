import { NextResponse, type NextRequest } from 'next/server';

/**
 * Pre-launch gate. While `BASIC_AUTH_USER` + `BASIC_AUTH_PASSWORD` are set, the
 * whole spectator dashboard sits behind HTTP Basic Auth so the idea stays private.
 * To go fully public at launch, just unset those env vars — no code change.
 */
export function middleware(request: NextRequest): NextResponse {
  const user = process.env['BASIC_AUTH_USER'];
  const pass = process.env['BASIC_AUTH_PASSWORD'];

  // No credentials configured → open (local dev, and the public go-live state).
  if (!user || !pass) {
    return NextResponse.next();
  }

  const header = request.headers.get('authorization');
  if (header?.startsWith('Basic ')) {
    const decoded = atob(header.slice('Basic '.length));
    const separator = decoded.indexOf(':');
    const suppliedUser = decoded.slice(0, separator);
    const suppliedPass = decoded.slice(separator + 1);
    if (suppliedUser === user && suppliedPass === pass) {
      return NextResponse.next();
    }
  }

  return new NextResponse('Authentication required.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Eviction Notice"' },
  });
}

export const config = {
  // Gate everything except Next internals and the favicon.
  matcher: ['/((?!_next/static|_next/image|icon.svg|favicon.ico).*)'],
};
