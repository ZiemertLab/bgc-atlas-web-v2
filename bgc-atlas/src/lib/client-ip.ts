// nginx sets X-Real-IP from $remote_addr, so the client cannot choose it. X-Forwarded-For's first entry
// is client-controlled, so fall back to its last hop (the one nginx appended), else 'unknown'.
export function getClientIp(request: Request): string {
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) {
    return realIp;
  }

  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
    if (hops.length > 0) {
      return hops[hops.length - 1];
    }
  }

  return 'unknown';
}

// For an `inet` column: null when unknown or malformed, so the insert cannot fail.
export function getClientIpOrNull(request: Request): string | null {
  const ip = getClientIp(request);
  return ip !== 'unknown' && /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null;
}
