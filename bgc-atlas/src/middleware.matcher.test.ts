import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

import { config } from './middleware';

// The function Next itself uses to compile `config.matcher` at build time. Not in
// its type declarations, hence the require.
const { getMiddlewareMatchers } = createRequire(import.meta.url)(
  'next/dist/build/analysis/get-page-static-info',
) as { getMiddlewareMatchers: (matcher: unknown, nextConfig: unknown) => { regexp: string }[] };

const matches = (path: string) => {
  const compiled = getMiddlewareMatchers(config.matcher, { i18n: null, basePath: '' });
  return compiled.some((m) => new RegExp(m.regexp).test(path));
};

describe('middleware matcher', () => {
  // Middleware running on a route makes Next keep only the first 10 MB of its body.
  it.each(['/api/contribute', '/api/search/bigslice/submit', '/api/search/sequence/submit'])(
    'skips the upload route %s',
    (path) => expect(matches(path)).toBe(false),
  );

  it.each([
    '/', '/studies/x', '/api/gcfs', '/api/contribute/validate', '/api/contributes',
    '/api/search/bigslice/submit/x', '/api/search/sequence/status', '/api/admin/jobs',
  ])('still runs on %s', (path) => expect(matches(path)).toBe(true));
});
