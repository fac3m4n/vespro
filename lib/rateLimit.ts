/**
 * A crude per-IP rate limit on the write routes.
 *
 * The deployed demo signs with shared testnet burner wallets, so every visitor spends
 * from the same faucet balance. Without a limit, one script can empty it and the demo is
 * dead exactly when a judge opens it. This is not a security control — it is there so the
 * thing still works at 15:00.
 *
 * In-memory, so it resets on cold start and is per-instance. That is the right trade for a
 * hackathon; a real deployment wants a shared store.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export function rateLimit(
  key: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now >= existing.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return { ok: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }

  existing.count += 1;

  // Opportunistic sweep so the map cannot grow without bound.
  if (buckets.size > 5_000) {
    for (const [k, bucket] of buckets) if (now >= bucket.resetAt) buckets.delete(k);
  }

  if (existing.count > limit) {
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000),
    };
  }

  return { ok: true, remaining: limit - existing.count, retryAfterSeconds: 0 };
}

/**
 * Best-effort client identity. Spoofable, which is fine: this protects a faucet
 * balance, not a trust boundary.
 */
export function clientKey(request: Request, scope: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "local";
  return `${scope}:${ip}`;
}

export function tooMany(result: RateLimitResult): Response {
  return Response.json(
    {
      error:
        "Rate limit reached. This demo signs with shared testnet wallets, so writes are " +
        "capped to keep the faucet balance alive. Try again shortly.",
      retryAfterSeconds: result.retryAfterSeconds,
    },
    { status: 429, headers: { "retry-after": String(result.retryAfterSeconds) } },
  );
}
