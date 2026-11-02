/**
 * Test Rate Limiting Suite for HueViVu API
 * Verifies Sliding Window Counter, RFC 6585 HTTP 429 response, and account/IP isolation.
 */

import assert from 'assert';
import { checkRateLimit, resetRateLimits, RATE_LIMIT_RULES, getClientIp } from '../src/lib/rate-limit.ts';

console.log('=== HueViVu Rate Limiting Test Suite ===\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed++;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

// 1. Basic limit enforcement
test('checkRateLimit allows requests up to the configured limit', () => {
  resetRateLimits();
  const key = 'test:login:1.2.3.4';
  const limit = 5;
  const windowMs = 60000;

  for (let i = 1; i <= limit; i++) {
    const res = checkRateLimit(key, limit, windowMs);
    assert.strictEqual(res.success, true, `Request ${i} should succeed`);
    assert.strictEqual(res.remaining, limit - i, `Remaining should be ${limit - i}`);
  }
});

// 2. Limit exceeded (HTTP 429 condition)
test('checkRateLimit rejects request exceeding limit and calculates retryAfterSeconds', () => {
  resetRateLimits();
  const key = 'test:login:1.2.3.4';
  const limit = 5;
  const windowMs = 60000;

  for (let i = 1; i <= limit; i++) {
    checkRateLimit(key, limit, windowMs);
  }

  const blocked = checkRateLimit(key, limit, windowMs);
  assert.strictEqual(blocked.success, false, '6th request must be blocked');
  assert.strictEqual(blocked.remaining, 0, 'Remaining should be 0');
  assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60, 'retryAfterSeconds should be between 1 and 60');
});

// 3. Key isolation (IP / User independence)
test('different IPs and Users do not block each other', () => {
  resetRateLimits();
  const limit = 3;
  const windowMs = 60000;

  // Max out IP 1
  for (let i = 0; i < limit; i++) {
    checkRateLimit('ip:192.168.1.1', limit, windowMs);
  }
  const blockedIp1 = checkRateLimit('ip:192.168.1.1', limit, windowMs);
  assert.strictEqual(blockedIp1.success, false, 'IP 1 must be blocked');

  // IP 2 must still be allowed
  const allowedIp2 = checkRateLimit('ip:192.168.1.2', limit, windowMs);
  assert.strictEqual(allowedIp2.success, true, 'IP 2 must be allowed even when IP 1 is blocked');
  assert.strictEqual(allowedIp2.remaining, limit - 1);
});

// 4. IP extraction helper
test('getClientIp parses headers correctly with fallback', () => {
  const reqWithForwarded = {
    headers: new Map([['x-forwarded-for', '203.0.113.195, 70.41.3.18, 150.172.238.178']]),
  };
  assert.strictEqual(getClientIp(reqWithForwarded), '203.0.113.195');

  const reqWithRealIp = {
    headers: new Map([['x-real-ip', '198.51.100.1']]),
  };
  assert.strictEqual(getClientIp(reqWithRealIp), '198.51.100.1');

  const reqEmpty = {
    headers: new Map(),
  };
  assert.strictEqual(getClientIp(reqEmpty), '127.0.0.1');
});

// Summary
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
