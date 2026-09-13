"use client";

import type { SwarmIdClient } from "@snaha/swarm-id";
import type { ConnectionInfo } from "@snaha/swarm-id";

/**
 * Swarm storage via Swarm ID.
 *
 * Swarm ID rather than Bee-js because there is no node to run: it signs postage
 * stamps in the browser and reads batch state from Gnosis directly, so the app
 * reaches Swarm through a public gateway with nothing to install. For Vespro that
 * is not just convenience — the whole point is that the seller's bytes are never
 * handled by our infrastructure, and an architecture with no backend upload path
 * cannot quietly acquire one.
 *
 * Everything here runs client-side, which is what keeps plaintext in the browser.
 * Ciphertext is all that ever crosses the network.
 */

const IFRAME_ORIGIN = "https://swarm-id.snaha.net";

let ready: Promise<SwarmIdClient> | null = null;

export type SwarmStatus = {
  connected: boolean;
  canUpload: boolean;
  identityName: string | null;
  /**
   * Why uploads are unavailable, when they are. Worth surfacing: a connected
   * identity with no postage batch still has `canUpload === false`, and the failure
   * otherwise shows up much later as an upload that just rejects.
   */
  reason: string | null;
};

let latest: SwarmStatus = {
  connected: false,
  canUpload: false,
  identityName: null,
  reason: "not initialised",
};

const listeners = new Set<(status: SwarmStatus) => void>();

function publish(info: ConnectionInfo | null) {
  latest = {
    connected: Boolean(info?.identity),
    canUpload: Boolean(info?.canUpload),
    identityName: info?.identity?.name ?? null,
    reason: !info?.identity
      ? "no Swarm ID connected"
      : !info.canUpload
        ? "connected, but no usable postage batch — redeem the gift code in Swarm ID"
        : null,
  };
  listeners.forEach((fn) => fn(latest));
}

export function onSwarmStatus(fn: (status: SwarmStatus) => void): () => void {
  listeners.add(fn);
  fn(latest);
  return () => listeners.delete(fn);
}

export function swarmStatus(): SwarmStatus {
  return latest;
}

/**
 * Returns the one client, creating it at most once.
 *
 * The promise is memoised *synchronously*. An earlier version checked a client handle and then
 * awaited a dynamic import, which yields — so two callers racing on mount both got past
 * the guard and each constructed a SwarmIdClient. Every client injects its own
 * fixed-position widget iframe, so the visible symptom was two Swarm connect buttons
 * stacked in the corner of the page.
 */
export const SWARM_SLOT_ID = "swarm-id-slot";

export function initSwarm(): Promise<SwarmIdClient> {
  ready ??= createClient();
  return ready;
}

async function createClient(): Promise<SwarmIdClient> {
  if (typeof window === "undefined") {
    throw new Error("Swarm ID is browser-only: initSwarm() cannot run on the server.");
  }

  try {
    // Imported here rather than at module scope: the library reaches for `window` as it
    // loads, which crashes the production prerender of any page that imports this file.
    const { SwarmIdClient } = await import("@snaha/swarm-id");

    /**
     * Mount Swarm's own widget inside our card rather than letting it float.
     *
     * Without a container it pins itself bottom-right, which meant the page showed two
     * ways to connect: ours and theirs. Theirs is the one that owns the auth UI, so it
     * wins and our button goes away.
     *
     * Checked rather than assumed: the library throws if the element is missing, and
     * falling back to the floating widget is much better than failing to initialise.
     */
    const slot = document.getElementById(SWARM_SLOT_ID) ? SWARM_SLOT_ID : undefined;

    const created = new SwarmIdClient({
      iframeOrigin: IFRAME_ORIGIN,
      metadata: {
        name: "Vespro",
        description: "Licence your wearable data for training without giving up the rows",
      },
      containerId: slot,
      onConnectionChange: publish,
    });

    await created.initialize();
    publish(created.connectionInfo);
    return created;
  } catch (error) {
    // Cleared so a transient failure does not permanently poison every later call.
    ready = null;
    throw error;
  }
}

export type SwarmStorage = {
  label: string;
  usedFraction: number;
  /**
   * 2^depth chunks of 4 KiB. This is the *theoretical* ceiling — chunks are assigned to
   * buckets by hash, so in practice a batch stops accepting uploads once any single bucket
   * fills, which happens well before the nominal figure. Labelled as such in the UI rather
   * than presented as guaranteed space.
   */
  capacityBytes: number;
  remainingBytes: number;
  /** Reported directly by the batch: how full the fullest bucket is, and out of how many. */
  bucketsUsed: number;
  bucketCount: number;
  depth: number;
  /** Seconds until the batch expires and Swarm stops keeping the chunks. */
  ttlSeconds: number | null;
  immutable: boolean;
  usable: boolean;
};

/**
 * How much room is left on the postage batch.
 *
 * Worth showing on the seller's side because a batch is prepaid, finite storage: an
 * upload that would exceed it fails at the point of sale, which is the worst moment to
 * discover it. Also relevant to whether a dataset can be re-uploaded later.
 *
 * Usage follows the standard Bee calculation — utilization counts filled buckets, and the
 * bucket count is 2^(depth - bucketDepth) — with capacity as 2^depth chunks of 4 KiB.
 */
export async function swarmStorage(): Promise<SwarmStorage | null> {
  const c = await initSwarm();
  const batch = await c.getPostageBatch();
  if (!batch) return null;

  const buckets = 2 ** (batch.depth - batch.bucketDepth);
  const usedFraction = buckets > 0 ? Math.min(1, batch.utilization / buckets) : 0;
  const capacityBytes = 2 ** batch.depth * 4096;

  return {
    label: batch.label || batch.batchID.slice(0, 8),
    usedFraction,
    capacityBytes,
    remainingBytes: Math.max(0, Math.round(capacityBytes * (1 - usedFraction))),
    bucketsUsed: batch.utilization,
    bucketCount: buckets,
    depth: batch.depth,
    ttlSeconds: batch.batchTTL ?? null,
    immutable: batch.immutableFlag,
    usable: batch.usable,
  };
}

export function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export function formatTtl(seconds: number | null): string {
  if (seconds === null) return "unknown";
  const days = Math.floor(seconds / 86400);
  if (days >= 1) return `${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 1) return `${hours}h`;
  return `${Math.max(0, Math.floor(seconds / 60))}m`;
}

/**
 * Whether this browser has authorised Swarm ID before.
 *
 * Same reasoning as the wallet flag: `initialize()` restores an existing session on its
 * own, but when it comes back with no identity we need to know whether that means "new
 * visitor" or "session lapsed, reconnect". Only the second should reconnect on its own.
 */
const SWARM_OPTED_IN_KEY = "vespro:swarm-opted-in";

function rememberSwarmOptIn() {
  try {
    localStorage.setItem(SWARM_OPTED_IN_KEY, "1");
  } catch {
    // Private-mode storage failure is not worth failing a connection over.
  }
}

export function swarmOptedIn(): boolean {
  try {
    return localStorage.getItem(SWARM_OPTED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export async function connectSwarm(): Promise<void> {
  const c = await initSwarm();
  await c.connect();
  rememberSwarmOptIn();
  publish(c.connectionInfo);
}

/**
 * Restores a Swarm session without user interaction, and without prompting.
 *
 * `initialize()` already rehydrates a stored session, so when there is one the status
 * simply arrives connected and there is nothing to do here.
 *
 * Deliberately does *not* call `connect()` as a fallback. Swarm ID can authenticate with
 * an Ethereum key, so connect() may ask the injected wallet to sign — which on page load
 * means an unexplained MetaMask popup on every refresh. Reconnecting is left to the
 * widget's own button, where the user asked for it.
 */
export async function restoreSwarm(): Promise<void> {
  const c = await initSwarm();
  publish(c.connectionInfo);
}

/** Returns the Swarm reference — the content hash that goes in the Arkiv payload. */
export async function uploadToSwarm(ciphertext: Uint8Array): Promise<string> {
  const c = await initSwarm();
  const info = c.connectionInfo;

  if (!info?.identity) throw new Error("Connect a Swarm ID before uploading.");
  if (!info.canUpload) {
    throw new Error(
      "Swarm ID is connected but has no usable postage batch. Redeem the ETHRome " +
        "gift code in the Swarm ID UI, then retry.",
    );
  }

  const result = await c.uploadData(ciphertext);
  return result.reference.toString();
}

export async function downloadFromSwarm(reference: string): Promise<Uint8Array> {
  const c = await initSwarm();
  return c.downloadData(reference as Parameters<SwarmIdClient["downloadData"]>[0]);
}
