# Arkiv evidence index

Everything a judge needs to reproduce the Arkiv part of Vespro, on Tiramisu
(chain `7738577`). SDK: `@arkiv-network/sdk` **0.8.1**.

Deployed app: https://vespro-ten.vercel.app
Explorer: https://tiramisu.explorer.arkiv.network

No private keys, seed phrases or credentialled RPC URLs appear in this repository. The
RPC endpoints in `.env.example` are the public Tiramisu HTTP and WebSocket endpoints.

---

## 1. Wallets

Both are throwaway keys generated for this hackathon. They are listed for technical
verification, not payment.

| Address | Role |
|---|---|
| [`0x2BAcd08Fd31CEb04e4938aC621b2804b239926F7`](https://tiramisu.explorer.arkiv.network/address/0x2BAcd08Fd31CEb04e4938aC621b2804b239926F7) | **Backend writer, and the only current Arkiv creator.** Creates listings and grants, extends listings, and patches trained weights. This is the address every read is pinned to with `.createdBy()`. |
| [`0xa4F498E6f2813a040890407B051075deE81525bb`](https://tiramisu.explorer.arkiv.network/address/0xa4F498E6f2813a040890407B051075deE81525bb) | **Demo buyer identity.** Its address is the value of the `buyer` attribute on grants, and it is the licensee the access check filters on. It no longer signs any Arkiv write — see the disclosure below. |

Ownership was never transferred: `changeOwnership` is not called anywhere in this
repository, so the creator is also the current owner of every entity.

### Disclosure: the grant creator changed mid-event

Grants were originally created by the buyer wallet. That was a bug, and a judge checking
older transactions on-chain will see the difference, so it is worth stating plainly.

Only an entity's **owner** may patch it, and the party that has to patch a grant is the
**seller**, delivering model weights after training. A buyer-created grant was one the
seller could not write into, so weights never arrived. Grants are now created by the
backend writer above, with the licensee recorded in the `buyer` attribute instead — which
is what the access check filters on, so nothing about the licence semantics changed.

Fixed in commit [`8bec828`](https://github.com/fac3m4n/vespro/commit/8bec828) and
explained at the top of `createGrant` in
[`lib/arkiv/entities.ts`](../lib/arkiv/entities.ts).

### Not Arkiv wallets

Listed only to avoid confusion when reading the app's evidence panel, which shows both
chains. These sign on Avalanche Fuji and create nothing on Arkiv:
`0x4b7866e717f27Fa1C38313D25F647aE0598571BD` (contract deployer and demo seller payee).

---

## 2. On-chain creation evidence

All created by `0x2BAcd08Fd31CEb04e4938aC621b2804b239926F7`.

### Listing entity — 13 Sep 2026, from the deployed app

| | |
|---|---|
| `listing_id` | `submission-evidence-418` |
| Entity key | [`0xff53e9c2fcd8e05ae052f57d2b34c2b0dc152311a005e509b2d35704cec1cc7e`](https://tiramisu.explorer.arkiv.network/entity/0xff53e9c2fcd8e05ae052f57d2b34c2b0dc152311a005e509b2d35704cec1cc7e) |
| Creation tx | [`0x52235e0e8b93563a9df660eadf862ecdf199bd847f3d45ec6873f33f1ff2223c`](https://tiramisu.explorer.arkiv.network/tx/0x52235e0e8b93563a9df660eadf862ecdf199bd847f3d45ec6873f33f1ff2223c) |
| Attributes | `project`, `kind=listing`, `domain=fitness`, `metric=heart_rate`, `region=EU`, `row_count=800` (i32), `price_per_day_wei=50000000000000000` (u64), `owner` (addr), `schema_hash` |
| Expiry | 15 minutes from creation, by design — see the limitation note below |

### Grant entity — the Mission 02 run

| | |
|---|---|
| `listing_id` | `e2e-mtzdixca` |
| Entity key | [`0x5deb9d9e9502c1a4bddc97d7b990b06cb35e7b61a6aeabf8ed608b26f4adfc68`](https://tiramisu.explorer.arkiv.network/entity/0x5deb9d9e9502c1a4bddc97d7b990b06cb35e7b61a6aeabf8ed608b26f4adfc68) |
| Creation tx | [`0x0d6f1393857334cc0a4d8a3ef690a5471ceef533b9d8b0784b8398251937e6c5`](https://tiramisu.explorer.arkiv.network/tx/0x0d6f1393857334cc0a4d8a3ef690a5471ceef533b9d8b0784b8398251937e6c5) |
| Licensee | `buyer = 0xa4F498E6f2813a040890407B051075deE81525bb` |
| Lifetime | 60s requested, **29 blocks** at 2s — floored, never rounded up |
| Expires at block | 384520, created at block 384491 |

### An earlier full run, kept for the paired Fuji settlement

From `arkiv/missions.md`, listing `prod-check-6774`: entity
[`0xf7efe1c6…`](https://tiramisu.explorer.arkiv.network/entity/0xf7efe1c6efe884bc498aedaf24e232bb78d2dae8775a78bff497d0d60f92de0f),
grant [`0x4f134ea7…`](https://tiramisu.explorer.arkiv.network/entity/0x4f134ea72ecbc22bc01ce565f21c3d52180ebfdf3cd2dea5413e6a4b8bc1ab86),
settled on Fuji in
[`0xf7d2677c…`](https://testnet.snowtrace.io/tx/0xf7d2677c334c448312c52f6513b2c9cd37c080087e0785a1519faa1b9d127098).
Note this grant predates the creator fix, so its creator is the buyer wallet.

**Every entity above has expired by now.** That is the product working, not a gap in the
evidence: grants live for the term purchased and listings for 15 minutes. The transaction
hashes are permanent and the creation receipts remain on the explorer. Nothing here is a
fixture — every hash is a real Tiramisu transaction. To see live entities, run
`npm run e2e`, or publish one on the deployed app and query within 15 minutes.

---

## 3. Reproducing the missions

### Mission 01 — Decommission: not attempted

We arrived with no indexer. Per the mission definition, inventing one to switch off would
not qualify, so it is deliberately not claimed.

### Mission 02 — Built to expire

**One command, about 70 seconds:**

```bash
npm run e2e     # scripts/e2e-expiry.mjs
```

It publishes a listing, buys a 60-second licence, then runs **the same access check** every
ten seconds across the expiry boundary and prints the query text each time so you can see
it did not change.

Output from the run cited above:

```
Access check query (identical at every step below):
  project = str('vespro-ethrome-2026-q7f3') AND kind = str('grant')
    AND listing_id = str('e2e-mtzdixca')
    AND buyer = addr(0xa4F498E6f2813a040890407B051075deE81525bb)
  ...createdBy(0x2BAcd08Fd31CEb04e4938aC621b2804b239926F7)

before purchase          licensed = false
grant created            0x5deb9d9e…
after purchase           licensed = true
+ 10s .. + 52s           licensed = true
+ 62s                    licensed = false
```

**The app change:** the buyer's "Run the access check" button flips from licensed to not
licensed, and the countdown reaches zero. The buyer keeps the model weights they already
received; what ends is the right to request more work against that dataset.

**No delete call exists.** Verify it yourself:

```bash
rg -n "deleteEntity|revoke" lib app contracts scripts
```

The single hit is a comment in `lib/arkiv/schema.ts` explaining the absence. There is also
no `expiresAt` column, no `revoked` boolean and no status enum anywhere in the schema.
(Widen it to `\.delete\(` and you get `Map.delete` in unrelated listener bookkeeping,
nothing touching an entity.)

**Source:**
- [`lib/arkiv/entities.ts`](../lib/arkiv/entities.ts) — `createGrant` sets
  `expires: ExpirationTime.fromSeconds(lifetimeSeconds)`; that is the entire licence
  mechanism. `renewListing` is the second pattern, a lease via `extendEntity`.
- [`lib/arkiv/queries.ts`](../lib/arkiv/queries.ts) — `liveGrant()`, the query that is
  identical on both sides of the boundary.
- [`app/api/grants/route.ts`](../app/api/grants/route.ts) — `GET` is the access check and
  returns the rendered query text with every answer, so the claim is checkable from the UI.
- README section **"Where each technology does real work → Arkiv"**.

**Worth knowing:** the term is anchored to the settling block on Fuji, not to the moment
the licence is written, so re-presenting one settlement transaction yields a grant expiring
at the same instant as the first. Replay is answered by arithmetic, which is why there is
no table of spent transaction hashes.

### Mission 03 — Live wire

**The client, and the line that matters** —
[`lib/arkiv/client.ts`](../lib/arkiv/client.ts):

```ts
export function arkivSubscriptionClient() {
  if (!WS_URL) {
    throw new Error(
      "NEXT_PUBLIC_ARKIV_RPC_WS is required. Vespro will not fall back to http() " +
        "because that turns every live subscription into a poll without saying so.",
    );
  }
  return createPublicClient({ chain: tiramisu, transport: webSocket(WS_URL) });
}
```

**The subscription** — [`lib/useEntityStream.ts`](../lib/useEntityStream.ts). No
`fromBlock`, and the transport is asserted before subscribing:

```ts
const transport = String(client.transport?.type ?? "unknown");
if (transport !== "webSocket") { /* refuses, and says why in the UI */ }
unwatch = client.watchEntityEvents({ onEvent, onError });  // no fromBlock
```

**Two-client demo:** open `/sell` and `/` in two windows. Buy a licence in the marketplace
window; the seller window wakes with no refresh and no polling loop, pulls the ciphertext
from Swarm, decrypts locally, trains, and patches the weights into the grant — which the
buyer window then receives, again over the subscription. Both windows show a
[`TransportBadge`](../components/TransportBadge.tsx) reading the live transport off the
client, so a viewer can confirm it says `webSocket` rather than taking our word for it.

**What we found, and what happens on a dropped connection** — the full write-up is finding
3 in [`arkiv/feedback.md`](feedback.md):

- Over an `http()` transport, `watchEntityEvents` silently polls once per second with
  byte-identical calling code. Nothing warns you. A demo built that way looks live and is
  not, which is why the transport is asserted in code *and* displayed in the UI.
- Passing `fromBlock` forces polling even over a websocket. The backfill you reach for
  after a drop is the thing that converts the subscription into the loop you were avoiding.
  So gaps are reconciled with a one-shot `select()` over http instead, and the socket is
  left to do only what a socket is good at.
- `onError` increments a visible reconnect counter rather than swallowing the failure. This
  matters because a watcher whose filter the node dropped just goes quiet, and a quiet
  watcher is indistinguishable from a quiet chain. Killing the network and restoring it
  shows the count increment; a poll can never show you this, which is the point.

**Known limitation, and it is a real one.** Tiramisu is a single shared namespace and
`WatchEntityEventsParameters` has no server-side filter — only handlers, `fromBlock` and
`pollingInterval`. The subscription therefore receives every entity event on the chain from
every project. We filter client-side on the event's `owner` field; before that, each
stranger's write cost one HTTP request to our own API and returned 404, roughly 46 requests
a minute. The transport badge shows both counts, "N events on chain · M ours", which also
makes an open socket visible while none of the traffic is ours.

---

## 4. Video timestamps

| Time | What it shows |
|---|---|
| 0:20 | Owner encrypts client-side; only ciphertext to Swarm |
| 0:55 | The rendered compound Arkiv query on the buyer's browse |
| 1:15 | Licence purchased — 60s term begins |
| 1:30 | Weights arrive with no refresh, transport badge reads `webSocket` (Mission 03) |
| 2:35 | Licence lapses; same query now matches nothing, no delete call (Mission 02) |

---

## 5. Feedback report

A quarter of the score, and it is a separate document:
**[`arkiv/feedback.md`](feedback.md)** — six findings with reproduction steps, including
`isValidAttributeName` accepting attribute names the chain then rejects with
`Ident32InvalidByte`, `getEntity` throwing rather than returning null for an expired
entity, and duration helpers rejecting odd second counts at runtime.
