"use client";

import { useEffect, useRef, useState } from "react";
import { arkivSubscriptionClient } from "./arkiv/client";

export type StreamEvent = {
  name: string;
  entityKey: string;
  /**
   * Who created or last wrote the entity.
   *
   * Carried through because Tiramisu is one shared namespace: the subscription delivers
   * every entity event on the chain, from every project. Without the owner there is no way
   * to reject a foreign entity except by asking the server about it, which meant one HTTP
   * request per stranger's write and a wall of 404s.
   */
  owner: string;
  blockNumber: string | null;
  at: string;
};

export type StreamState = {
  events: StreamEvent[];
  /**
   * Every event the socket delivered, including other projects'. Kept because it is the
   * honest measure of whether the subscription is alive — our own writes are rare, so a
   * feed filtered down to them looks identical to a dead socket.
   */
  received: number;
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
export function useEntityStream(
  onEvent?: (event: StreamEvent) => void,
  /**
   * Only surface entities written by this address. Everything else on the chain is still
   * counted in `received`, but never reaches the handler.
   */
  options?: { owner?: string | null },
) {
  const [state, setState] = useState<StreamState>({
    events: [],
    received: 0,
    transport: "unknown",
    live: false,
    error: null,
    reconnects: 0,
  });

  /**
   * Read through refs so changing the filter does not tear down the socket.
   *
   * `filtering` is separate from the address on purpose. The address arrives from an async
   * request, so for the first moments it is null — and treating null as "no filter wanted"
   * let the whole chain through during that window, which is exactly the burst of requests
   * this filter exists to prevent. Asking for a filter at all is enough to withhold events
   * until the address is known.
   */
  const filtering = useRef(Boolean(options && "owner" in options));
  filtering.current = Boolean(options && "owner" in options);
  const ownerFilter = useRef(options?.owner);
  ownerFilter.current = options?.owner;

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

          // Every event carries an owner except OwnershipTransferred, which names the old
          // and new holder instead. Narrowed rather than cast so a future event type
          // without an owner is a type error here and not a silent mismatch.
          const owner = "owner" in event ? String(event.owner) : "";
          const wanted = ownerFilter.current;
          const mine = filtering.current
            ? Boolean(wanted) && owner.toLowerCase() === wanted!.toLowerCase()
            : true;

          // Counted either way: a shared chain is busy, and that traffic is the proof the
          // socket is open even when none of it is ours.
          setState((s) => ({ ...s, received: s.received + 1 }));
          if (!mine) return;

          const entry: StreamEvent = {
            name: event.type,
            entityKey: String(event.entityKey ?? ""),
            owner,
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
