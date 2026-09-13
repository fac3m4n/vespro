# Arkiv data model — Vespro

> **Attribute names are snake_case, and this is not a style preference.** The engine
> rejects uppercase letters in attribute names — `listingId` reverts with
> `Ident32InvalidByte(7, 0x49)` — while the SDK's own `isValidAttributeName` accepts
> it. Do not "tidy" these into camelCase. See finding 1 in `feedback.md`.

Two entity types. The split between **attributes** (queryable) and **payload** (not
queryable) is the whole design: anything a buyer filters on has to be an attribute,
or every browse turns into a scan.

## Why Arkiv, and not a Web2 database

**The user-visible capability:** a buyer filters a marketplace of encrypted datasets on
five dimensions at once — domain, metric, row count, price, region — and a licence they
buy stops working by itself when its term ends.

**The query the app depends on** is the access check. Swarm holds the bytes but can only
answer "give me this hash"; it cannot answer "fitness, heart-rate, 500+ rows, under this
price, in the EU". Arkiv entities are queryable and time-scoped, so one expression does
both jobs: the same filter that finds a listing also decides whether a licence exists,
and it decides by returning nothing once the entity has expired.

**Against Postgres.** A Web2 build is genuinely easier: one `SELECT`, one `expires_at`
column, one nightly sweep. What it cannot offer is the part buyers and sellers need to
believe — that access ended, and that the licence they hold was actually paid for.
Postgres answers both questions with rows only its operator can see or change, so both
claims reduce to trusting us. On Arkiv the licence is a public entity whose immutable
`$creator` shows who issued it and whose expiry is enforced by the chain rather than by
our cron job. Deleting a row is a promise; letting an entity expire is a property.

**The trade-offs, plainly.** Writes cost gas and are not instant, so this is wrong for
high-frequency data. There is no server-side ordering, so top-N sorting happens
client-side after fetching. Every entity is public, which is why no measurement and no
key is ever written to one — see below. And an unscoped query reads other projects' rows,
which is a failure mode a private Postgres instance simply does not have.

## What deliberately stays off Arkiv

Nothing here contains a fitness measurement. The rows live encrypted on Swarm and
are never uploaded anywhere else. Arkiv entities are public and verifiable by
design, so they carry commitments and coarse metadata only.

Specifically kept out of every entity:

- **Measurements.** No heart rate, no sleep interval, no step count. Only `row_count`
  and a `schema_hash` that commits to column names and order.
- **The AES-256-GCM dataset key.** It is generated in the seller's browser and never
  transmitted. The 96-bit IV *is* in the payload, because an IV is not a secret.
- **Private keys of any kind.** Signing keys live in a gitignored `.env.local`, never
  under a `NEXT_PUBLIC_` prefix, so they cannot reach the browser bundle.
- **Anything identifying a person.** No wallet is linked to a name, and no free-text
  field accepts more than a 500-character dataset description.

## `project` — namespacing, on every entity and every query

Tiramisu is one shared public namespace, so `kind = "listing"` is not a distinctive
name and an unscoped query reads other projects' rows. Every Vespro entity carries
`project = "vespro-ethrome-2026-q7f3"`, and every query filters on it — see
`lib/arkiv/project.ts`.

This scopes; it does not authorise. Anyone holding gas can write that attribute, which
is why reads additionally pin `$creator` (below).

## Trust: `$creator`, not attributes

Attributes are writable by any funded wallet. An access check written only against
attributes is therefore satisfied by anyone who writes `kind=grant, buyer=<themselves>`
— a licence forged for the price of one transaction. `$creator` is fixed at creation and
cannot be reassigned, so every read in `lib/arkiv/entities.ts` is scoped with
`.createdBy()` to the wallet that issues entities:

```ts
await publicClient
  .select({ key: true })
  .where(liveGrant(listing_id, buyer))
  .createdBy(trustedCreator())
  .limit(1)
  .fetch()
```

Reproduce it: run `npm run e2e`, which prints the rendered expression and the creator it
pins before, during and after the licence window.

## Entity types

Two, and no more than the product query needs.

### `listing`

A dataset offered for training. Long-lived: renewed by the owner while the listing should
stay visible, and if the owner stops renewing it drops out of the marketplace on its own.

#### Attributes (queryable)

| Attribute | Type | Why it is an attribute |
|---|---|---|
| `project` | `str` | Scopes every query to this app's rows |
| `kind` | `str`, `"listing"` | Separates the two entity types in every query |
| `domain` | `str`, e.g. `"fitness"` | First filter a buyer applies |
| `metric` | `str`, e.g. `"heart_rate"` | Narrows to a trainable signal |
| `row_count` | `i32` | Range filter — buyers want a minimum |
| `price_per_day_wei` | `u64` | Range filter — buyers want a maximum |
| `region` | `str`, e.g. `"EU"` | Buyers have jurisdiction constraints |
| `owner` | `addr` | Owner dashboard queries its own listings |
| `schema_hash` | `str` | Buyer checks column compatibility before paying |

`row_count` is `i32` and `price_per_day_wei` is `u64` rather than strings, because
string attributes only support equality and prefix matching — a `>=` or `<=` filter on a
stringified number is not a range query. `u64` also sets the ceiling on a daily price,
which the API enforces up front so the failure is a readable 400 instead of an
`InvalidValueError` thrown from inside `createEntity`.

The buyer's browse is a **compound filter**, not single-attribute equality:

```
kind = "listing" AND domain = "fitness" AND metric = "heart_rate"
  AND row_count >= 500 AND price_per_day_wei <= 2000000000000000
```

#### Payload (not queryable)

- `swarmHash` — where the ciphertext actually lives
- `sampleSwarmHash` — a small plaintext synthetic sample, so buyers can look before paying
- `columns` — column names and units
- `description` — free text

`swarmHash` is deliberately *not* an attribute. Nobody filters by content hash, and
putting it in attributes would only widen the index for no query.

### `grant`

A paid licence, and the reason Arkiv is here.

**The Entity Expiration is the licence.** A grant is created with a lifetime equal to the
purchased duration. Access checks are a query for a live grant. When the licence runs out
the entity expires and the query stops returning it — there is no revocation job, no
cron sweep, and no delete call anywhere in this codebase.

That lifetime is measured back from the end of the term recorded on Fuji rather than
forward from the moment of the request, so presenting the same settlement transaction
twice yields a second licence expiring at the same instant as the first. Replay is
answered by arithmetic instead of a table of spent hashes.

**A grant is issued by the seller's wallet, not the buyer's.** Only an entity's owner may
patch it, and the party that has to patch a grant is the seller, delivering model weights
after training. Creating it as the buyer produced a grant the seller could not write into
— `EntityMutationError: ... is owned by <buyer>, not <owner>` — so the weights never
arrived. The licensee is recorded in the `buyer` attribute, which is what the access check
filters on, and `owner` records the seller.

#### Attributes (queryable)

| Attribute | Type | Why it is an attribute |
|---|---|---|
| `project` | `str` | Scopes every query to this app's rows |
| `kind` | `str`, `"grant"` | — |
| `listing_id` | `str` | Which dataset this licenses |
| `buyer` | `addr` | The access check filters on it |
| `owner` | `addr` | Powers the owner's live earnings feed |
| `settlement_tx` | `str` | Fuji transaction that paid for it |

The access check, run before the owner's browser will train anything:

```ts
await publicClient
  .select({ key: true })
  .where(
    eq("project", str("vespro-ethrome-2026-q7f3")),
    eq("kind", str("grant")),
    eq("listing_id", str(listing_id)),
    eq("buyer", addr(buyer)),
  )
  .createdBy(trustedCreator())
  .limit(1)
  .fetch()
```

which the node receives as:

```
project = str('vespro-ethrome-2026-q7f3') AND kind = str('grant')
  AND listing_id = str(<id>) AND buyer = addr(<address>)
```

Zero rows means no licence. Absence is the signal. Reproduce it with `npm run e2e`, or
call `GET /api/grants?listing_id=…&buyer=…`, which returns the rendered expression next to
the answer so the two are checkable against each other.

#### Payload (not queryable)

- `jobSpec` — the model and hyperparameters the buyer asked for
- `purchasedSeconds` — what was paid for, kept for the receipt
- `trained` — the delivered weights, bias and loss curve, patched in once by the seller

## Entity Expiration and Lifetime Extension, both patterns

Arkiv Mission 02 lists two patterns. Vespro uses both, because a marketplace needs both.

- **Lapse as signal** — a `grant` is allowed to die. Its Entity Expiration *is* the
  licence term, so access ends because time passed and nothing had to notice.
- **Lease / sliding expiry** — a `listing` uses **Lifetime Extension** to push its
  boundary out each time it is renewed. A seller who walks away stops renewing, and their
  listing quietly leaves the market without anyone running a cleanup job.

One detail worth stating because it is easy to get backwards: a Lifetime Extension
**sets** a new expiry measured from now, rather than adding to the time remaining, and the
engine rejects an extension that would not move the expiry later. `renewListing` therefore
passes a full `LISTING_LIFETIME_SECONDS` rather than a delta.

Demo lifetimes are **60 to 120 seconds**, not days. Arkiv's brief is explicit that
nobody can wait around on Sunday morning, so the boundary has to be crossable on
camera.
