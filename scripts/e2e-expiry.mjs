/**
 * Mission 02 evidence, as a reproducible script. Run with `npm run e2e`.
 *
 * Writes a grant with a short lifetime, runs the access check, waits past the
 * boundary, and runs the identical check again. The point is the absence of a third
 * step: nothing deletes the grant, and no expiry field is compared against a clock.
 *
 * Prints the rendered query both times so the two checks are visibly the same query.
 */
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { addr, str } from "@arkiv-network/sdk/attr";
import { and, eq, render } from "@arkiv-network/sdk/query";
import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")).trim(),
      line.slice(line.indexOf("=") + 1).trim(),
    ]),
);

const LIFETIME_SECONDS = 60;

// Kept in step with lib/arkiv/project.ts. Tiramisu is one shared namespace, so an
// unscoped query reads other projects' entities.
const PROJECT = "vespro-ethrome-2026-q7f3";

const read = createPublicClient({
  chain: tiramisu,
  transport: http(env.NEXT_PUBLIC_ARKIV_RPC_HTTP),
});
const buyerAccount = privateKeyToAccount(env.ARKIV_BUYER_PRIVATE_KEY);
const ownerAccount = privateKeyToAccount(env.ARKIV_OWNER_PRIVATE_KEY);
// Grants are issued by the owner wallet, as in the app: only an entity's owner may patch
// it, and the owner is the party that has to deliver model weights into the grant.
const owner = createWalletClient({
  chain: tiramisu,
  transport: http(env.NEXT_PUBLIC_ARKIV_RPC_HTTP),
  account: ownerAccount,
});

const listing_id = `e2e-${Date.now().toString(36)}`;
const accessCheck = and(
  eq("project", str(PROJECT)),
  eq("kind", str("grant")),
  eq("listing_id", str(listing_id)),
  eq("buyer", addr(buyerAccount.address)),
);

console.log(`\nListing:  ${listing_id}`);
console.log(`Buyer:    ${buyerAccount.address}`);
console.log(`Issuer:   ${ownerAccount.address}`);
console.log(`Lifetime: ${LIFETIME_SECONDS}s\n`);
console.log(`Access check query (identical at every step below):`);
console.log(`  ${render(accessCheck)}`);
console.log(`  ...createdBy(${ownerAccount.address})\n`);

/**
 * The same check the app runs. `.createdBy()` is part of it: attributes are writable by
 * anyone holding gas, so without pinning the immutable creator this query is satisfied by
 * any wallet that writes `kind=grant, buyer=<itself>` — a licence forged for the price of
 * a transaction.
 */
async function licensed() {
  const result = await read
    .select({ key: true })
    .where(accessCheck)
    .createdBy(ownerAccount.address)
    .limit(1)
    .fetch();
  return result.entities.length > 0;
}

console.log(`before purchase          licensed = ${await licensed()}`);

const { entityKey, txHash } = await owner.createEntity({
  payload: jsonToPayload({ listing_id, purchasedSeconds: LIFETIME_SECONDS }),
  contentType: "application/json",
  attributes: {
    project: str(PROJECT),
    kind: str("grant"),
    listing_id: str(listing_id),
    buyer: addr(buyerAccount.address),
    owner: addr(ownerAccount.address),
    settlement_tx: str("e2e-no-settlement"),
  },
  expires: ExpirationTime.fromSeconds(LIFETIME_SECONDS),
});

console.log(`\ngrant created            ${entityKey}`);
console.log(`tx                       ${txHash}`);

const created = await read.getEntity(entityKey);
console.log(`expires at block         ${created.expiresAt}`);
console.log(`current block            ${await read.getBlockNumber()}\n`);

console.log(`after purchase           licensed = ${await licensed()}`);

const deadline = Date.now() + (LIFETIME_SECONDS + 20) * 1000;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 10_000));
  const still = await licensed();
  const elapsed = Math.round((Date.now() - (deadline - (LIFETIME_SECONDS + 20) * 1000)) / 1000);
  console.log(`+${String(elapsed).padStart(3)}s                    licensed = ${still}`);
  if (!still) {
    console.log(`\nThe grant stopped matching the query.`);
    console.log(`No delete was issued by this script — grep it. The entity's lifetime ran out.`);
    process.exit(0);
  }
}

console.log(`\nStill licensed after the window. Investigate before relying on this.`);
process.exit(1);
