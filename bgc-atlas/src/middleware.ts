import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  apiRateLimit,
  getClientIp,
  checkRateLimit,
} from '@/lib/rate-limit';

// Node.js runtime: ioredis does not run on the Edge runtime.
export const config = {
  runtime: 'nodejs',
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};

// These either enforce their own stricter limit or are cached read-only reads.
const GENERAL_LIMIT_EXCLUSIONS = [
  '/api/search/',
  '/api/statistics/',
  '/api/samples',
  '/api/bgcs',
  '/api/gcfs',
  '/api/exports/',
  '/api/site-notice', // Asked on every page load; a memoised Redis read
];

function selectRateLimit(request: NextRequest, pathname: string) {
  if (GENERAL_LIMIT_EXCLUSIONS.some((path) => pathname.startsWith(path))) return null;

  return {
    limiter: apiRateLimit,
    identifier: getClientIp(request),
  };
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-time', Date.now().toString());

  if (pathname.startsWith('/api/')) {
    const selected = selectRateLimit(request, pathname);

    if (selected) {
      const rateLimitResult = await checkRateLimit(selected.limiter, selected.identifier);

      if (!rateLimitResult.success) {
        return NextResponse.json(
          {
            error: rateLimitResult.error,
            retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
          },
          {
            status: 429,
            headers: {
              'Retry-After': String(Math.ceil((rateLimitResult.reset - Date.now()) / 1000)),
              'X-RateLimit-Limit': String(rateLimitResult.limit),
              'X-RateLimit-Remaining': String(rateLimitResult.remaining),
              'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
            },
          }
        );
      }

      const response = NextResponse.next({
        request: {
          headers: requestHeaders,
        },
      });

      response.headers.set('X-RateLimit-Limit', String(rateLimitResult.limit));
      response.headers.set('X-RateLimit-Remaining', String(rateLimitResult.remaining));
      response.headers.set('X-RateLimit-Reset', new Date(rateLimitResult.reset).toISOString());

      return response;
    }
  }

  return NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });
}
