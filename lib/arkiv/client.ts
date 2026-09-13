import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket } from "viem";
import { nonceManager, privateKeyToAccount } from "viem/accounts";

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
 * Two funded burner keys rather than one platform key: the owner wallet is the data
 * seller and the buyer wallet is the licensee. Keys stay in the server process; they are
 * never sent to the browser and never prefixed NEXT_PUBLIC_.
 *
 * Entities are written by the **owner** wallet — both listings and the grants issued
 * against them — because only an entity's owner may patch it, and the seller is the
 * party that has to deliver model weights into a grant after training. The buyer wallet
 * still identifies the licensee: it is recorded in the grant's `buyer` attribute, which
 * is what the access check filters on.
 *
 * `nonceManager` allocates nonces locally instead of asking the node for each one.
 * Every write now originates from one wallet, and two concurrent requests would
 * otherwise fetch the same nonce and one would be dropped.
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
    account: privateKeyToAccount(key as `0x${string}`, { nonceManager }),
  });
}

export function roleAddress(role: Role): `0x${string}` {
  return arkivWriteClient(role).account.address;
}

/**
 * The only wallet whose entities this app will read.
 *
 * `$creator` is fixed at creation and cannot be reassigned, so it is the one field a
 * forger cannot fake — unlike an attribute, which any funded wallet can write. Every
 * read in `entities.ts` is scoped to this address. Without that scope, writing
 * `kind=grant, buyer=<self>` is enough to pass the access check having paid nothing.
 *
 * A production build with per-seller keys would filter on the seller's own address,
 * taken from the listing being licensed, rather than on one platform wallet.
 */
export function trustedCreator(): `0x${string}` {
  const override = process.env.ARKIV_TRUSTED_CREATOR;
  if (override) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(override)) {
      throw new Error("ARKIV_TRUSTED_CREATOR is not a 20-byte address.");
    }
    return override as `0x${string}`;
  }
  return roleAddress("owner");
}
