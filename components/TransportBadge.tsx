"use client";

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
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
          good
            ? "bg-emerald-500/10 text-emerald-300 ring-1 ring-emerald-500/30"
            : "bg-amber-500/10 text-amber-300 ring-1 ring-amber-500/30"
        }`}
      >
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            good ? "animate-pulse bg-emerald-400" : "bg-amber-400"
          }`}
        />
        transport: {state.transport}
        {good ? " · subscription open" : " · not live"}
      </span>

      <span className="text-neutral-500">no fromBlock, no polling interval</span>

      {state.reconnects > 0 && (
        <span className="text-amber-400">{state.reconnects} reconnect(s)</span>
      )}

      {state.error && (
        <span className="w-full text-amber-400/90">{state.error}</span>
      )}
    </div>
  );
}
