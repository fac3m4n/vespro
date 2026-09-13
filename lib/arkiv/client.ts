import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const WS_URL = process.env.NEXT_PUBLIC_ARKIV_RPC_WS;
const HTTP_URL = process.env.NEXT_PUBLIC_ARKIV_RPC_HTTP;

/**
 * Reads and, critically, subscriptions.
 *
 * The transport choice is the whole difference between a subscription and a poll.
 * `watchEntityEvents` accepts a `pollingInterval` and works over `http()` — it just
 * degrades to a one-second poll, and the calling code is byte-for-byte identical.
 * A websocket transport is the only thing that makes it a real server-pushed stream,
 * so it is not optional here and there is no http fallback: a silent downgrade to
 * polling is worse than a startup error.
 */
export function arkivSubscriptionClient() {
  if (!WS_URL) {
    throw new Error(
      "NEXT_PUBLIC_ARKIV_RPC_WS is required. Vespro will not fall back to http() " +
        "because that turns every live subscription into a poll without saying so.",
    );
  }
  return createPublicClient({
    chain: tiramisu,
    transport: webSocket(WS_URL),
  });
}

/** Reads that are one-shot request/response. http is the right tool here. */
export function arkivReadClient() {
  return createPublicClient({
    chain: tiramisu,
    transport: http(HTTP_URL),
  });
}

export type Role = "owner" | "buyer";

/**
 * Writes. Server-side only.
 *
 * Two funded burner keys rather than one platform key, so a listing is genuinely
 * owned by the seller's wallet and a grant by the buyer's — `ownedBy()` queries and
 * Arkiv's ownership model both mean something. Keys stay in the server process; they
 * are never sent to the browser and never prefixed NEXT_PUBLIC_.
 */
export function arkivWriteClient(role: Role) {
  const key =
    role === "owner"
      ? process.env.ARKIV_OWNER_PRIVATE_KEY
      : process.env.ARKIV_BUYER_PRIVATE_KEY;

  if (!key) {
    throw new Error(
      `Missing ${role === "owner" ? "ARKIV_OWNER_PRIVATE_KEY" : "ARKIV_BUYER_PRIVATE_KEY"}. ` +
        "Fund two burner wallets from https://hub.arkiv.network/faucet and put them in .env.local.",
    );
  }
  if (!key.startsWith("0x") || key.length !== 66) {
    throw new Error(`${role} key is not a 32-byte hex private key.`);
  }

  return createWalletClient({
    chain: tiramisu,
    transport: http(HTTP_URL),
    account: privateKeyToAccount(key as `0x${string}`),
  });
}

export function roleAddress(role: Role): `0x${string}` {
  return arkivWriteClient(role).account.address;
}
