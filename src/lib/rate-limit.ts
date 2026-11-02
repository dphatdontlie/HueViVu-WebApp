/**
 * In-memory Sliding Window Rate Limiter for HueViVu API
 * Conforms to RFC 6585 (HTTP 429 Too Many Requests)
 */

import type { NextRequest } from 'next/server';

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  resetMs: number;
  retryAfterSeconds: number;
}

// In-memory sliding log store
const memoryStore = new Map<string, number[]>();

// Periodically prune stale keys to prevent memory leaks (runs unref'd so it won't block process exit)
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, timestamps] of memoryStore.entries()) {
    // Drop records where all timestamps are older than 1 hour
    const fresh = timestamps.filter(t => now - t < 3600000);
    if (fresh.length === 0) {
      memoryStore.delete(key);
    } else if (fresh.length !== timestamps.length) {
      memoryStore.set(key, fresh);
    }
  }
}, 60000);

if (typeof cleanupInterval.unref === 'function') {
  cleanupInterval.unref();
}

/**
 * Reset memory store (useful for automated testing)
 */
export function resetRateLimits(): void {
  memoryStore.clear();
}

/**
 * Safely extract client IP from NextRequest
 */
export function getClientIp(req: NextRequest | Request): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = req.headers.get('x-real-ip');
  if (realIp) return realIp.trim();
  return '127.0.0.1';
}

/**
 * Sliding window rate check
 * @param key Unique key for the rate limit (e.g., 'login:192.168.1.1' or 'chat:user_123')
 * @param limit Maximum allowed requests in the time window
 * @param windowMs Time window in milliseconds (default: 60,000ms = 1 minute)
 */
export function checkRateLimit(key: string, limit: number, windowMs = 60000): RateLimitResult {
  // Allow explicit bypass in test environments if set
  if (process.env.DISABLE_RATE_LIMIT === '1') {
    return { success: true, limit, remaining: limit, resetMs: windowMs, retryAfterSeconds: 0 };
  }

  const now = Date.now();
  const windowStart = now - windowMs;
  const timestamps = (memoryStore.get(key) || []).filter(t => t > windowStart);

  if (timestamps.length >= limit) {
    const oldestInWindow = timestamps[0];
    const resetMs = Math.max(0, oldestInWindow + windowMs - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
    return {
      success: false,
      limit,
      remaining: 0,
      resetMs,
      retryAfterSeconds,
    };
  }

  timestamps.push(now);
  memoryStore.set(key, timestamps);

  return {
    success: true,
    limit,
    remaining: Math.max(0, limit - timestamps.length),
    resetMs: windowMs,
    retryAfterSeconds: 0,
  };
}

/**
 * Generate standard RFC HTTP 429 response
 */
export function rateLimitResponse(result: RateLimitResult, customMessage?: string): Response {
  const retrySec = result.retryAfterSeconds;
  const message = customMessage || `Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ${retrySec} giây.`;

  return Response.json(
    {
      error: message,
      retryAfter: retrySec,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(retrySec),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil((Date.now() + result.resetMs) / 1000)),
      },
    }
  );
}

// Preset helpers
export const RATE_LIMIT_RULES = {
  AUTH_LOGIN: { limit: 5, windowMs: 60000 },     // 5 requests / 1 minute
  AUTH_REGISTER: { limit: 3, windowMs: 60000 },  // 3 requests / 1 minute
  FEEDBACK: { limit: 3, windowMs: 60000 },       // 3 requests / 1 minute
  CHAT: { limit: 10, windowMs: 60000 },          // 10 requests / 1 minute
};
