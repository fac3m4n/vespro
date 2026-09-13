# Mission evidence

Captured against the deployed app, not a local dev server. Everything below is
reproducible with `npm run e2e` against your own keys.

Deployment: https://vespro-gv1i10rx1-akerimberdigmailcoms-projects.vercel.app
Chain: Arkiv Tiramisu testnet (`7738577`) · settlement on Avalanche Fuji C-Chain

---

## Mission 02 — expiry as the access control mechanism

The claim: **a licence is an entity whose TTL is its term.** Access ends because the
entity ceases to exist, not because anything was revoked. The access check is a query,
and that query is byte-identical before, during and after the licence.

### Production run, 13 Sep 2026

Listing published (Arkiv entity + Fuji terms registration):

| | |
|---|---|
| listing_id | `prod-check-6774` |
| entity key | `0xf7efe1c6efe884bc498aedaf24e232bb78d2dae8775a78bff497d0d60f92de0f` |
| Arkiv tx | `0x4cd61f045ce152245a66fb7b8300c022e1dd1da01f9b8eabc29f96c584be0882` |
| Fuji terms tx | `0x73c4e94b44820f09b91452b18d177d78557419693ad2e3bcbec781f6d812f065` |

Then a 60-second licence was bought and allowed to lapse. The `query` field is returned
by the API on every check specifically so this is verifiable rather than asserted:

| Time | `licensed` | Query |
|---|---|---|
| 02:33:26Z (before) | `false` | `kind = str('grant') AND listing_id = str('prod-check-6774') AND buyer = addr(0xa4F4…)` |
| 02:33:36Z (after purchase) | `true` | *identical* |
| 02:34:58Z (+75s) | `false` | *identical* |

Purchase:

| | |
|---|---|
| grant entity | `0x4f134ea72ecbc22bc01ce565f21c3d52180ebfdf3cd2dea5413e6a4b8bc1ab86` |
| Arkiv tx | `0x6d7fd588dc488976f3104dd63e81fb80d1adc8d80bbb08da9c5dd290eb9f3273` |
| Fuji settlement | [`0xf7d2677c…`](https://testnet.snowtrace.io/tx/0xf7d2677c334c448312c52f6513b2c9cd37c080087e0785a1519faa1b9d127098) |
| paid | 694444444444 wei (60s pro-rated from the daily price) |

### The claim is checkable, not just stated

No delete or revoke call exists in this codebase. Grep it:

```
rg -n "deleteEntity|revoke" lib app contracts scripts
```

The only hits are `Map.delete` in unrelated listener bookkeeping and a comment in
`lib/arkiv/schema.ts` explaining the absence. There is also no `expiresAt` column, no
`revoked` boolean and no status enum — **absence of the entity is the signal.**

That is the part worth taking from this: expiry is not a cleanup job bolted onto a
permissions table, it *is* the permissions table. The failure mode most access-control
code has — a revocation write that silently doesn't land, leaving access open — cannot
happen here, because the grant's continued existence is what has to be paid for.

### The sliding-expiry half

Listings use the same mechanism in the opposite direction. A listing lives 15 minutes
and `renewListing` calls `extendEntity` to push the boundary out, so an owner who stops
maintaining a dataset stops paying and the listing disappears on its own. No reaper
process, no orphaned rows advertising data nobody will serve.

---

## Mission 03 — a real subscription, not a poll wearing a subscription's clothes

The trap here is that `watchEntityEvents` accepts an `http()` transport and, with
byte-identical calling code, silently degrades to a one-second poll. Nothing warns you.
A demo built that way looks live and isn't.

Vespro refuses to be ambiguous about which one it's doing:

**1. The client will not fall back.** `arkivSubscriptionClient()` throws rather than
quietly using http:

```
NEXT_PUBLIC_ARKIV_RPC_WS is required. Vespro will not fall back to http()
because that turns every live subscription into a poll without saying so.
```

**2. The transport is asserted at subscribe time.** `lib/useEntityStream.ts` reads
`client.transport.type` and refuses to subscribe unless it is `webSocket`, surfacing the
reason in the UI instead of showing a plausible-looking feed.

**3. No `fromBlock`.** Passing it forces polling even over a websocket. The omission is
deliberate and commented at the call site so nobody helpfully "fixes" it later.

**4. The UI shows the answer.** `components/TransportBadge.tsx` displays the live
transport and the reconnect count, so a judge can confirm the mechanism without reading
source.

### What it drives

The live feed isn't decoration — it's the trigger. When a buyer's grant entity appears,
the *owner's* browser wakes up, pulls the ciphertext from Swarm, decrypts it locally,
trains, and publishes only the resulting weights via `patchEntity`. The subscription is
load-bearing: without it there is no signal to start training on, and the plaintext
would have to sit somewhere waiting.

### Reconnect behaviour

`onError` increments a reconnect counter rather than swallowing the failure, so a dropped
websocket is visible in the badge instead of appearing as a feed that has simply gone
quiet. A poll can never show you this, which is rather the point.
