"use client";

import { Radio, TriangleAlert } from "lucide-react";
import type { StreamState } from "@/lib/useEntityStream";

/**
 * Mission 03 evidence, on screen.
 *
 * A two-window demo cannot tell a socket from a one-second poll — both look instant.
 * So the transport is read off the live client and shown, and the badge only claims
 * "live" when it is genuinely `webSocket`. If it ever says `http`, the honest reading
 * is that this is a polling loop wearing a subscription's clothes.
 */
export function TransportBadge({ state }: { state: StreamState }) {
  const good = state.live && state.transport === "webSocket";

  return (
    <div className="flex flex-col items-start gap-1.5 text-xs sm:items-end">
      <span
        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 font-medium ring-1 ${
          good
            ? "bg-success/10 text-success ring-success/30"
            : "bg-warning/10 text-warning ring-warning/30"
        }`}
      >
        {good ? (
          <span className="relative flex size-1.5">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-success opacity-75" />
            <span className="relative inline-flex size-1.5 rounded-full bg-success" />
          </span>
        ) : (
          <TriangleAlert className="size-3" />
        )}
        <span className="font-mono">{state.transport}</span>
        {good ? "· subscription open" : "· not live"}
      </span>

      <span className="flex items-center gap-1 text-muted-foreground">
        <Radio className="size-3" />
        no fromBlock, no polling interval
      </span>

      {/* The chain is shared, so most of this traffic is other projects'. Showing the
          total is what makes an open socket visible while none of it is ours. */}
      <span className="text-muted-foreground">
        {state.received} event{state.received === 1 ? "" : "s"} on chain ·{" "}
        {state.events.length} ours
      </span>

      {state.reconnects > 0 && (
        <span className="text-warning">{state.reconnects} reconnect(s)</span>
      )}

      {state.error && <span className="max-w-xs text-warning/90 sm:text-right">{state.error}</span>}
    </div>
  );
}
