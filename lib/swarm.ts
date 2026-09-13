"use client";

import { SwarmIdClient } from "@snaha/swarm-id";
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

let client: SwarmIdClient | null = null;
let ready: Promise<void> | null = null;

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

export async function initSwarm(): Promise<SwarmIdClient> {
  if (client && ready) {
    await ready;
    return client;
  }

  client = new SwarmIdClient({
    iframeOrigin: IFRAME_ORIGIN,
    metadata: {
      name: "Vespro",
      description: "Licence your wearable data for training without giving up the rows",
    },
    onConnectionChange: publish,
  });

  ready = client.initialize();
  await ready;
  publish(client.connectionInfo);
  return client;
}

export async function connectSwarm(): Promise<void> {
  const c = await initSwarm();
  await c.connect();
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
