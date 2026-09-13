"use client";

import { useEffect, useState } from "react";
import { HardDrive } from "lucide-react";
import { formatBytes, formatTtl, swarmStorage, type SwarmStorage } from "@/lib/swarm";

/**
 * Remaining room on the postage batch.
 *
 * A batch is prepaid, finite storage with an expiry, so both numbers matter to a seller:
 * a dataset that will not fit fails at upload, and one stored on a batch about to lapse
 * stops being retrievable. Better to see it before publishing than after.
 */
export function SwarmStorageBar() {
  const [storage, setStorage] = useState<SwarmStorage | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    swarmStorage()
      .then((result) => {
        if (!cancelled) setStorage(result);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "unavailable");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <p className="text-sm text-muted-foreground">Storage unavailable: {error}</p>;
  if (!storage) return <p className="text-sm text-muted-foreground">Reading postage batch…</p>;

  const pct = storage.usedFraction * 100;
  // A few KB against a 32 GiB batch rounds to 0%, which reads as "nothing was stored".
  // Enough precision to show that something landed.
  const used = pct > 0 && pct < 0.01 ? "<0.01" : pct.toFixed(pct < 1 ? 2 : 0);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="flex items-center gap-2 text-muted-foreground">
          <HardDrive className="size-3.5" />
          <span className="font-mono">{storage.label}</span>
          <span className="text-xs">depth {storage.depth}</span>
          {storage.immutable && <span className="text-xs">immutable</span>}
        </span>
        <span>
          <span className="font-medium">{formatBytes(storage.remainingBytes)}</span>
          <span className="text-muted-foreground">
            {" "}
            of {formatBytes(storage.capacityBytes)} theoretical
          </span>
        </span>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${pct > 90 ? "bg-destructive" : "bg-success"}`}
          style={{ width: `${Math.max(1, Math.round(pct))}%` }}
        />
      </div>

      <p className="text-xs text-muted-foreground">
        {used}% used · {storage.bucketsUsed}/{storage.bucketCount} buckets · expires in{" "}
        {formatTtl(storage.ttlSeconds)}
        {storage.usable ? "" : " · batch not usable yet"}
      </p>

      <p className="text-xs text-muted-foreground">
        Theoretical because chunks land in buckets by hash — a batch stops accepting uploads
        when any one bucket fills, which happens before the nominal figure.
      </p>
    </div>
  );
}
