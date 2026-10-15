import { Ratelimit } from '@upstash/ratelimit';
import type Redis from 'ioredis';
import redisClient from '@/lib/redis-client';
import { getClientIp, getClientIpOrNull } from '@/lib/client-ip';

export { getClientIp, getClientIpOrNull };

// Upstash's typedef requires evalsha + get + set, but at runtime its limiter only
// calls eval / evalsha / scriptLoad, hence the cast below.
class IORedisAdapter {
  constructor(private client: Redis) {}

  async eval(script: string, keys: string[], args: string[]): Promise<unknown> {
    return this.client.eval(script, keys.length, ...keys, ...args);
  }

  async evalsha(sha: string, keys: string[], args: string[]): Promise<unknown> {
    return this.client.evalsha(sha, keys.length, ...keys, ...args);
  }

  async scriptLoad(script: string): Promise<string> {
    return (this.client as unknown as { script: (cmd: string, arg: string) => Promise<string> }).script('LOAD', script);
  }
}

const redis = new IORedisAdapter(redisClient);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const redisAsUpstash = redis as any;

// Shared by sequence and BiG-SLiCE submissions. Counts searches that were queued, not
// requests: the routes charge a slot up front, so an exhausted client gets its 429
// before a 500 MB upload is read, and refund it when no job is queued.
export const searchRateLimit = new Ratelimit({
  redis: redisAsUpstash,
  limiter: Ratelimit.slidingWindow(10, '1 h'),
  analytics: false,
  prefix: 'ratelimit:search',
});

// Every submit request, accepted or not: the backstop the refunds need. middleware.ts
// exempts /api/search/ from the general limiter, and a rejected BiG-SLiCE upload has
// already been written to disk before its LOCUS check fails.
export const searchAttemptRateLimit = new Ratelimit({
  redis: redisAsUpstash,
  limiter: Ratelimit.slidingWindow(60, '1 h'),
  analytics: false,
  prefix: 'ratelimit:search-attempt',
});

export const exportRateLimit = new Ratelimit({
  redis: redisAsUpstash,
  limiter: Ratelimit.slidingWindow(20, '1 h'),
  analytics: false,
  prefix: 'ratelimit:export',
});

// /api/contribute accepts up to 500 MB uploads (nginx client_max_body_size) written to CephFS.
export const contributeRateLimit = new Ratelimit({
  redis: redisAsUpstash,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  analytics: false,
  prefix: 'ratelimit:contribute',
});

export const feedbackRateLimit = new Ratelimit({
  redis: redisAsUpstash,
  limiter: Ratelimit.slidingWindow(5, '1 h'),
  analytics: false,
  prefix: 'ratelimit:feedback',
});

// /api/bgcs is exempt from the general limiter, so GET /api/bgcs/[id]/download carries this.
// Token bucket rather than a 1 h slidingWindow, whose reset (end of the clock hour) would
// make Retry-After wrong; a bucket's reset is its next refill.
export const DOWNLOAD_BURST = 300;
export const DOWNLOAD_REFILL_PER_MINUTE = 5;
export const downloadRateLimit = new Ratelimit({
  redis: redisAsUpstash,
  limiter: Ratelimit.tokenBucket(DOWNLOAD_REFILL_PER_MINUTE, '1 m', DOWNLOAD_BURST),
  analytics: false,
  prefix: 'ratelimit:download-bucket',
});

// The third tokenBucket argument is maxTokens, the bucket's ceiling, not extra burst on top
// of the refill. One browse page costs 2-5 calls.
export const apiRateLimit = new Ratelimit({
  redis: redisAsUpstash,
  limiter: Ratelimit.tokenBucket(100, '1 m', 100),
  analytics: false,
  prefix: 'ratelimit:api',
});

export async function checkRateLimit(
  limiter: Ratelimit,
  identifier: string,
): Promise<{
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  error?: string;
}> {
  try {
    const result = await limiter.limit(identifier);

    if (!result.success) {
      const waitSeconds = Math.ceil((result.reset - Date.now()) / 1000);
      const waitMinutes = Math.ceil(waitSeconds / 60);

      return {
        success: false,
        limit: result.limit,
        remaining: 0,
        reset: result.reset,
        error: waitMinutes > 1
          ? `Rate limit exceeded. Please wait ${waitMinutes} minutes before trying again.`
          : `Rate limit exceeded. Please wait ${waitSeconds} seconds before trying again.`,
      };
    }

    return {
      success: true,
      limit: result.limit,
      remaining: result.remaining,
      reset: result.reset,
    };
  } catch (error) {
    console.error('Rate limiter error:', error);

    // Fail open during a Redis outage.
    return {
      success: true,
      limit: 0,
      remaining: 0,
      reset: 0,
    };
  }
}

// Give back a slot that checkRateLimit charged. A negative rate is Upstash's refund.
// Never throws: a failed refund only leaves the client one slot short.
export async function refundRateLimit(limiter: Ratelimit, identifier: string): Promise<void> {
  try {
    await limiter.limit(identifier, { rate: -1 });
  } catch (error) {
    console.error('Rate limiter refund error:', error);
  }
}
