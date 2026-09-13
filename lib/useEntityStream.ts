"use client";

import { useEffect, useRef, useState } from "react";
import { arkivSubscriptionClient } from "./arkiv/client";

export type StreamEvent = {
  name: string;
  entityKey: string;
  blockNumber: string | null;
  at: string;
};

export type StreamState = {
  events: StreamEvent[];
  /** What the transport actually is, read off the live client rather than assumed. */
  transport: string;
  /** True only while a websocket subscription is genuinely open. */
  live: boolean;
  error: string | null;
  /** Counts reconnects, so a dropped socket is visible instead of silent. */
  reconnects: number;
};

/**
 * Live entity events over a websocket subscription.
 *
 * Two things here are deliberate, and both are the mission rather than incidental:
 *
 * `fromBlock` is never passed. It looks like the obvious way to backfill after a drop,
 * but asking to replay history forces the watcher into polling — so the recovery you
 * reach for is exactly what converts your subscription back into the loop you were
 * trying to avoid. Vespro reconciles a gap with a one-shot `select()` over http
 * instead, and leaves the socket to do only what a socket is good at.
 *
 * The transport is asserted, not assumed. `watchEntityEvents` over `http()` still
 * works, still fires the same handlers, and quietly polls once a second. Reading the
 * transport key off the client is the only way the UI can honestly claim it is live.
 */
export function useEntityStream(onEvent?: (event: StreamEvent) => void) {
  const [state, setState] = useState<StreamState>({
    events: [],
    transport: "unknown",
    live: false,
    error: null,
    reconnects: 0,
  });

  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    let unwatch: (() => void) | undefined;
    let cancelled = false;

    try {
      const client = arkivSubscriptionClient();
      const transport = String(client.transport?.type ?? "unknown");

      if (transport !== "webSocket") {
        setState((s) => ({
          ...s,
          transport,
          live: false,
          error: `Transport is "${transport}", not "webSocket" — this would be a 1s poll, not a subscription.`,
        }));
        return;
      }

      setState((s) => ({ ...s, transport, live: true, error: null }));

      unwatch = client.watchEntityEvents({
        // No fromBlock. See the note above: it would force polling.
        onEvent: (event) => {
          if (cancelled) return;
          const entry: StreamEvent = {
            name: event.type,
            entityKey: String(event.entityKey ?? ""),
            blockNumber: event.blockNumber?.toString() ?? null,
            at: new Date().toISOString(),
          };
          setState((s) => ({ ...s, events: [entry, ...s.events].slice(0, 40) }));
          handler.current?.(entry);
        },
        onError: (error) => {
          if (cancelled) return;
          setState((s) => ({
            ...s,
            live: false,
            error: error.message,
            reconnects: s.reconnects + 1,
          }));
        },
      });
    } catch (error) {
      setState((s) => ({
        ...s,
        live: false,
        error: error instanceof Error ? error.message : "failed to open subscription",
      }));
    }

    return () => {
      cancelled = true;
      unwatch?.();
    };
  }, []);

  return state;
}
