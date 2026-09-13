# Vespro
<img width="1220" height="678" alt="Screenshot 2026-09-13 at 07 46 41" src="https://github.com/user-attachments/assets/6d332e56-6db4-4a25-b5be-776c811d621d" />

**Sell access to your data without handing over the rows.**

You own a dataset worth training on. Today you either upload it to a platform that
takes a cut and keeps a copy, or you don't sell it at all. Vespro is a third option:
your data stays encrypted under a key that never leaves your browser, buyers licence
it for a fixed term, and they get model weights back instead of your data.

Built at [ETHRome 2026](https://ethrome.org/hackermanual). Themes: Privacy and AI.

Mission completed: Mission 02 — Built to expire. A licence ends because its Arkiv entity
expired on its own; nothing deletes it and no cleanup job runs. Mission 03 — Live wire is
delivered alongside it: the seller's UI reacts to entity changes over a WebSocket
subscription with no polling fallback.

### Mission 02 evidence — the same query either side of natural expiration

Reproduce with `npm run e2e`. This run is from Tiramisu, 13 Sep 2026:

| | |
|---|---|
| Requested lifetime | 60s — **30 blocks** at 2s per block |
| Applied expiry | block `381902`, against block `381873` at creation — **29 blocks** as applied |
| Grant entity | `0x7761082548cf0f365a40ef71c7157b5edf8d3d6ffa135da925655fc37e983cb6` |
| Creation tx | `0xc766d9733374bd70dbe8370164b162608ed94bc504e6a6c71819219399c07af0` |

The query is byte-identical at every step; only the answer changes.

```
project = str('vespro-ethrome-2026-q7f3') AND kind = str('grant')
  AND listing_id = str('e2e-mtzaepis') AND buyer = addr(0xa4F498E6…)
  ...createdBy(0x2BAcd08F…)
```

| Step | `licensed` |
|---|---|
| before purchase | `false` |
| after purchase | `true` |
| +10s … +52s | `true` |
| +62s, past the applied expiry block | `false` |

**No delete caused that change.** `rg -n "deleteEntity" lib app contracts scripts` returns
nothing, and the script issues no cleanup of any kind — the entity's lifetime ran out and
the query stopped matching it. Full write-up, including the Mission 03 transport
assertion, is in [`arkiv/missions.md`](arkiv/missions.md).

Every line of this repository was written during ETHRome 2026. No pre-existing codebase
was carried in; the dependencies are the published SDKs listed in `package.json`.

| | |
|---|---|
| **Repo** | https://github.com/fac3m4n/vespro — public, no invitation needed |
| **Live demo** | https://vespro-ten.vercel.app |
| **Demo video** | [YouTUbe](https://www.youtube.com/watch?v=TQ1sknXDSiU) |
| **Arkiv evidence index** | [`arkiv/submission.md`](arkiv/submission.md) — wallets, entity keys, tx hashes, how to reproduce each mission |
| **Arkiv feedback report** | [`arkiv/feedback.md`](arkiv/feedback.md) — six findings with reproduction steps |
| **Bytes** | Encrypted on [Swarm](https://ethswarm.org) via Swarm ID |
| **Index and licences** | [Arkiv](https://arkiv.network) on Tiramisu, chain `7738577` |
| **Settlement** | Avalanche Fuji C-Chain — [`0x3e4e5bf7…de94b29`](https://testnet.snowtrace.io/address/0x3e4e5bf72803e2d18d313613fa2f16662de94b29) |

---

## The idea in one flow

1. A seller generates a wearable dataset, and their **browser** encrypts it with
   AES-256-GCM. The key is written to `localStorage` and goes nowhere else.
2. The **ciphertext** is uploaded to Swarm through Swarm ID, which returns a content
   hash. No server of ours ever touches the plaintext, because there is no upload
   path through our backend to touch it with.
3. An **Arkiv listing entity** is written: the Swarm hash sits in the payload, and the
   things buyers filter on — domain, metric, row count, price, region — become typed
   queryable attributes.
4. A buyer **browses with a compound Arkiv query**. Swarm cannot answer "fitness,
   heart-rate, 500+ rows, under this price, EU"; it only has hashes. Arkiv can.
5. The buyer **pays on Avalanche Fuji**, and only then is a **grant entity** issued by
   the seller's wallet whose *lifetime is the licence term*. The payment is checked to be
   for this listing, this buyer and this term before the licence exists.
6. The seller's tab sees the sale over a **websocket subscription**, decrypts locally,
   trains locally, and patches the resulting weights back into the grant. The seller can
   patch it because the seller owns it — patching is an owner-only operation, which is
   what decides who issues a grant.
7. The licence **expires on its own**. The access check is the same query it always
   was, and it returns nothing. No revocation job, no cron, no `delete` call.

## What is actually private, stated precisely

Hackathon claims about privacy are usually doing some work they haven't earned, so
here is exactly what holds and what doesn't.

**What holds.** The buyer never receives a row and never receives a key. They send
hyperparameters and get back four weights, a bias and a loss curve. Our server only
ever sees ciphertext and metadata. Nothing in any Arkiv entity contains a
measurement — only coarse metadata and a SHA-256 commitment to the column schema,
because Arkiv entities are public by design and personal data does not belong in one.

**What doesn't.** This is **not** training under encryption. The owner's own browser
decrypts locally, because it holds the key — so the honest description is one round
of federated learning with a single participant, not homomorphic training. Doing this
with no decryption anywhere means FHE, which is real (Zama's Concrete ML) and nowhere
near interactive speed for training. We chose the version that works and described it
accurately rather than the version that demos as a spinner.

**What a production build would need.** A key derived from a passkey or held in a KMS
rather than `localStorage`; a differential-privacy budget on returned weights, since
a model trained on few enough rows leaks information about them; and attestation that
the training code that ran is the code that was agreed. None of those are here.

## Where each technology does real work

### Arkiv — the index and the licence

Arkiv is not storage here; it is the queryable, expiring layer over content-addressed
data, which is what its docs describe it as.

**Compound filters, not scans.** The buyer's browse is one expression evaluated by
the node, built in [`lib/arkiv/queries.ts`](lib/arkiv/queries.ts). The UI shows the
rendered query text, so "Arkiv is doing the work" is checkable rather than claimed:

```
kind = "listing" AND domain = "fitness" AND metric = "heart_rate"
  AND row_count >= 500 AND price_per_day_wei <= 5000000000000000
```

**Entity Expiration is the product.** A grant is created with
`ExpirationTime.fromSeconds(term)` and that is the entire licence mechanism. Grep the
repo: there is no `deleteEntity` call, no `revoked` attribute, and no `expiresAt` column
compared against a clock. Both expiry patterns are in use — grants **lapse**, and absence
is the signal, while listings use **Lifetime Extension** to push their expiry forward on
renewal, so a seller who walks away leaves the market without anyone running a cleanup
job. Note that a Lifetime Extension *sets* a new expiry measured from now rather than
adding to the time remaining, and the engine rejects one that would not move the expiry
later — `renewListing` passes a full lifetime for exactly that reason.

**The term is anchored to the payment, not to the request.** A grant's Entity Expiration
is measured back from the end of the term recorded on Fuji, so re-presenting a settlement
transaction produces a licence expiring at the same instant as the first one. That is why
there is no table of spent transaction hashes anywhere: replay is answered by arithmetic
rather than by bookkeeping.

**Absence has to mean unpaid, so reads pin the creator.** Arkiv attributes are writable
by anyone holding gas, which means an access check written only against attributes is
satisfied by any wallet that writes `kind=grant, buyer=<itself>`. Every read in
[`lib/arkiv/entities.ts`](lib/arkiv/entities.ts) is therefore scoped with `.createdBy()`
to the wallet that issues grants; `$creator` is immutable, so it is the one field a
forger cannot fake.

**A real subscription, asserted.** `lib/useEntityStream.ts` opens
`watchEntityEvents` over a `webSocket()` transport and never passes `fromBlock`,
because replaying history forces polling. It reads `client.transport.type` and the UI
only claims to be live when that is literally `"webSocket"` — over `http()` the same
code silently polls once a second and looks identical. Details in
[`arkiv/feedback.md`](arkiv/feedback.md).

The data model and the attributes-versus-payload reasoning are in
[`arkiv/schema.md`](arkiv/schema.md).

### Swarm — where the bytes live, and why they have to

Swarm holds the encrypted datasets. It earns its place for a reason specific to this
product: **Vespro's whole pitch is that no platform holds your data, and an
architecture with no backend upload path cannot quietly grow one.** Swarm ID signs
postage stamps in the browser and reads batch state from Gnosis directly, so there is
no Bee node to run and no server-side upload route to be tempted by. If the bytes
were in our S3 bucket, "you own your data" would be a promise about our conduct
instead of a property of the system.

Content addressing does a second job: the Swarm hash in an Arkiv listing pins exactly
which bytes were licensed, so a seller cannot swap the dataset after a sale.

Code: [`lib/swarm.ts`](lib/swarm.ts). Uses Swarm ID rather than Bee-js.

### Avalanche Fuji — settlement

A data licence is a financial right with a lifecycle: an asset rule (the term and
price), an eligibility policy (a grant only exists for the buyer who paid), and
settlement (payment precedes the licence). `purchase()` is called on Fuji and the
transaction hash is written into the grant's attributes, so every licence points at
the payment that created it. Proceeds are **credited, not pushed** — `owed[dataOwner]`
plus a `withdraw()`, so a purchase never hands control to the recipient mid-transaction. Payment happens **before** the grant is written; if
settlement isn't configured the app says `settled: false` and labels it, rather than
minting a licence nobody paid for. Code: [`lib/fuji.ts`](lib/fuji.ts).

## Running it

```bash
npm install
cp .env.example .env.local
npm run check      # RPC reachable, wallets funded, websocket really a websocket
npm run dev
```

You need two Tiramisu burner wallets funded from the [Arkiv
faucet](https://hub.arkiv.network/faucet), and a Swarm ID with a usable postage batch
(the ETHRome gift code covers it). `npm run check` tells you which of those is
missing rather than letting it fail later as a confusing UI error.

Then open two windows: `/sell` to publish a dataset, `/` to licence it. Buy a **60s**
licence, run the access check, wait for the countdown, and run the same check again.

### Deploying

```bash
npm run verify:fuji   # so Snowtrace shows function names, not bare selectors
npm run env:sync      # copy .env.local into the Vercel project
npm run deploy:web
```

`env:sync` is the step that is easy to miss. Passing variables to a single deploy with
`--env` does not store them on the project, so a build triggered by a git push has none
of them — and that build *succeeds*, then fails at runtime, because the websocket client
throws without `NEXT_PUBLIC_ARKIV_RPC_WS` and every write route throws without its
signing key. `NEXT_PUBLIC_*` values are inlined at build time, so changing one needs a
fresh build rather than a redeploy of the same output.

## Layout

| Path | What |
|---|---|
| `lib/arkiv/project.ts` | Project attribute — namespacing in a shared database |
| `lib/arkiv/schema.ts` | Attributes vs payload, licence terms |
| `lib/arkiv/queries.ts` | Compound filters, the access check |
| `lib/arkiv/entities.ts` | Create, extend, patch, read; creator-pinned reads |
| `lib/useEntityStream.ts` | Websocket subscription, transport assertion |
| `lib/crypto.ts` | AES-256-GCM, key handling |
| `lib/swarm.ts` | Swarm ID upload and retrieval |
| `lib/training.ts` | Logistic regression, owner-side |
| `lib/fuji.ts` | Fuji settlement |
| `arkiv/schema.md` | The data model, and why it is shaped that way |
| `arkiv/feedback.md` | Arkiv feedback report |

## Security notes

This repo is public and stays public. Every credential lives in a gitignored
`.env.local`; `.env.example` documents the shape with empty values. Wallets are
CSPRNG-generated burners funded only from testnet faucets, and no signing key is
exposed under a `NEXT_PUBLIC_` prefix, which would ship it into the browser bundle.
We deliberately did not use the shared private key printed in the Arkiv SDK README —
see finding 1 in [`arkiv/feedback.md`](arkiv/feedback.md).

Encryption is AES-256-GCM via WebCrypto with a fresh 96-bit IV per dataset, generated
internally so it cannot be passed in and reused — IV reuse is the one catastrophic
misuse of GCM. GCM rather than CBC or ECB because it authenticates: on a public
network, detecting tampering matters as much as preventing reading.

## Where we would take it next

Replace single-participant local training with real multi-party federated rounds, so
a buyer can commission a model across many sellers' datasets at once and no
individual contribution is recoverable from the result — at which point the
differential-privacy budget stops being a footnote and becomes the product.

## Licence

MIT. See [LICENSE](LICENSE).
