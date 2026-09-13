# Arkiv submission — answers to copy

Untracked. Not committed.

---

## Project name

```
Vespro
```

## What did you build?

```
Anyone holding data worth training on has two options today: hand it to a platform that
takes a cut and keeps a copy, or don't sell it at all. Vespro is a marketplace where a
buyer licences a dataset for a fixed term and receives trained model weights instead of
rows — the encryption key never leaves the owner's browser and only ciphertext reaches
Swarm. Working today: an owner encrypts a CSV client-side and publishes typed attributes
to Arkiv plus terms to Avalanche Fuji; a buyer narrows listings with one compound Arkiv
query and pays on Fuji; the owner's tab wakes on an Arkiv WebSocket subscription,
decrypts locally, trains, and patches the weights back into the grant; and the licence
then ends on its own, because the grant entity's lifetime *is* the term that was paid for.
```

## Public GitHub repository

```
https://github.com/fac3m4n/vespro
```

## Deployed dapp

```
https://vespro-ten.vercel.app
```

## Demo video URL

```
<paste your link — check it plays in a private window>
```

## Missions completed

- [ ] Mission 01 — Decommission
- [x] **Mission 02 — Built to expire**
- [x] **Mission 03 — Live wire**

**Do not tick Mission 01.** It requires arriving with a subgraph, Ponder or Postgres
indexer already running and moving its read path to Arkiv. The manual is explicit: "If you
did not arrive with an indexer already running, pick another mission rather than inventing
one to turn off." Ticking it also declares pre-existing work, which shrinks what gets
judged. We built from scratch, so it does not apply.

## Why Arkiv / Web3 database?

```
Three things Arkiv does here that a Web2 database cannot, in the order they matter.

1. Expiration is the licence, not a chore attached to it. A grant is created with
ExpirationTime.fromSeconds(term) and that is the whole access-control mechanism. There is
no deleteEntity call anywhere in the repo, no `revoked` attribute and no `expiresAt`
column compared against a clock — grep it. In Postgres the equivalent is a TTL sweeper or
a WHERE now() < expires_at that some service has to be trusted to run, and its classic
failure is a revocation write that silently doesn't land, leaving access open. Here the
grant's continued existence is the thing that was paid for, so the dangerous direction of
failure is gone. Both patterns are in use: grants lapse and absence is the signal, while
listings use lifetime extension as a lease, so a seller who walks away leaves the market
with nobody running a cleanup job.

2. The query is verifiable, and so is who wrote the row. This is the part that surprised
us. Arkiv attributes are writable by anyone holding gas, so an access check written only
against attributes is satisfied by any wallet that writes kind=grant, buyer=<itself> — the
licence would be forgeable. Every read in lib/arkiv/entities.ts is therefore scoped with
.createdBy() to the wallet that issues grants, because $creator is immutable and is the
one field a forger cannot fake. That gives a buyer something a Web2 API cannot: they can
verify their own licence directly against the chain without trusting our server to answer
honestly. A hosted database can always lie about its own rows.

3. Real typed filters, evaluated by the node. The browse is one compound expression built
in lib/arkiv/queries.ts over typed attributes — kind and domain and metric and region as
str, row_count as i32, price_per_day_wei as u64 — not single-key equality and not a scan
narrowed in JavaScript afterwards. The UI renders the exact query text it sent, so "Arkiv
is doing the work" is checkable rather than asserted:

  project = 'vespro-ethrome-2026-q7f3' AND kind = 'listing' AND domain = 'fitness'
    AND row_count >= 500 AND price_per_day_wei <= 5000000000000000

Trade-offs we accepted, honestly:

- Entities are public, so nothing sensitive can go in them. That shaped the architecture
  rather than being worked around: the rows are AES-256-GCM ciphertext on Swarm, and Arkiv
  holds only a schema-hash commitment and the queryable metadata. Arkiv is the index; it is
  not storage and not a confidentiality layer.
- Writes cost gas and confirm in blocks, so this suits licences and listings — low
  frequency, high value — and would be wrong for per-request logging.
- Lifetimes are whole 2-second blocks, so durations are floored rather than rounded, to
  avoid ever selling more time than was paid for.
- Tiramisu is one shared namespace, so kind='listing' collides with any other team that
  picked the same obvious word. Entities carry a project label and every read filters on
  it — but the label is only a namespace, since anyone can write one. Trust comes from
  $creator, which is why it is pinned separately.

Detail: README "Where each technology does real work → Arkiv", plus arkiv/schema.md for
the attributes-versus-payload reasoning and arkiv/missions.md for on-chain evidence.
```

### Shorter version, if the field is length-limited

```
Expiration is the licence itself: a grant is created with ExpirationTime.fromSeconds(term)
and there is no deleteEntity call, no `revoked` flag and no expiresAt column in the repo.
In Postgres this is a TTL sweeper someone must be trusted to run, whose classic failure —
a revocation write that never lands — leaves access open; here the grant's existence is
what was paid for, so that direction of failure does not exist. Second, attributes are
writable by anyone with gas, so an access check on attributes alone is forgeable: reads are
scoped with .createdBy() to the issuing wallet because $creator is immutable, which lets a
buyer verify their licence against the chain instead of trusting our server. Third, the
browse is one compound filter over typed attributes (i32 row_count, u64 price_per_day_wei,
str domain/metric/region) evaluated by the node, and the UI shows the query it actually
sent. Trade-offs: entities are public so the rows are AES-256-GCM ciphertext on Swarm with
only a schema-hash commitment on Arkiv; writes cost gas so this fits licences, not logs;
lifetimes are whole 2-second blocks so we floor durations rather than oversell time.
```

## Who will use this, and how will you reach your first 100 users?

```
Two sides, and the honest answer is that we would seed only one.

Supply: people who already export their own wearable data — Oura, Whoop, Apple Health —
and who resent that the platform monetises it and they don't. They are not hypothetical:
the quantified-self community already keeps CSVs of exactly this shape.

Demand: small ML teams and independent builders who need niche health data that is
expensive to buy and legally awkward to obtain. They do not want a copy of anyone's rows;
they want a model. Vespro gives them a term licence and weights, which is a much easier
compliance story than holding someone's heart-rate history.

The problem we solve is the deadlock between them: the owner will not surrender the data,
and the buyer cannot train without it. Expiring, verifiable licences let both sides act
without either trusting a platform to hold the data or to switch access off later.

First 100, concretely: a marketplace with one side is worthless, so seed supply in a
single vertical — resting heart rate and sleep — where the schema is narrow enough that
one model type serves every buyer. The channel is r/QuantifiedSelf and the Oura and Whoop
subreddits and Discords, where people already post their exports and the pitch is "get
paid for the file you already have, without uploading it anywhere readable". Hand-hold the
first twenty sellers personally. Buyers are then reachable where people look for datasets
— Hugging Face forums and Kaggle discussions — but only once there is stock worth
querying, so demand outreach is deliberately second, not parallel.

Nearer-term wedge, if the consumer side proves slow: the same primitive — an access grant
that is an entity whose lifetime is the paid term, verifiable by the buyer without
trusting the seller's API — is what any pay-per-term data licensing business needs. That
is a B2B sale to companies already licensing data feeds, and it does not require a
two-sided market to start.
```

---

## Before you submit

- **The feedback report is 25% of the score and the questions above have no field for
  it.** Look for a later page in the form. If there genuinely is no field, paste this into
  the nearest free-text box or append it to the "Why Arkiv" answer:

  ```
  Feedback report: https://github.com/fac3m4n/vespro/blob/main/arkiv/feedback.md
  Six findings with reproduction steps, including: isValidAttributeName accepts attribute
  names the chain then rejects with Ident32InvalidByte; watchEntityEvents silently polls
  over an http transport; getEntity throws rather than returning null for an expired
  entity; and the SDK README publishes a working private key.
  ```

- SDK used, if asked: `@arkiv-network/sdk` **0.8.1**, on Tiramisu, chain `7738577`.
- Parts of Arkiv touched, if asked: createEntity, patchEntity, extendEntity,
  watchEntityEvents over webSocket, select() with field projection, query combinators
  (and/eq/gte/lte), ExpirationTime, typed attributes (str/i32/u64/addr), `.createdBy()`
  creator scoping.
- Do **not** tick "pre-existing project" on the ETHRome form. The README states every line
  was written during the event.
- Tick Arkiv on the ETHRome form too, so the organisers know where to send judges.
