# Arkiv data model — Vespro

> **Attribute names are snake_case, and this is not a style preference.** The engine
> rejects uppercase letters in attribute names — `listingId` reverts with
> `Ident32InvalidByte(7, 0x49)` — while the SDK's own `isValidAttributeName` accepts
> it. Do not "tidy" these into camelCase. See finding 1 in `feedback.md`.

Two entity types. The split between **attributes** (queryable) and **payload** (not
queryable) is the whole design: anything a buyer filters on has to be an attribute,
or every browse turns into a scan.

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

## 1. `listing` — a dataset offered for training

Long-lived. Renewed by the owner while the listing should stay visible; if the
owner stops renewing, the listing drops out of the marketplace on its own.

### Attributes (queryable)

| Attribute | Type | Why it is an attribute |
|---|---|---|
| `project` | string | Scopes every query to this app's rows |
| `kind` | string, `"listing"` | Separates the two entity types in every query |
| `domain` | string, e.g. `"fitness"` | First filter a buyer applies |
| `metric` | string, e.g. `"heart_rate"` | Narrows to a trainable signal |
| `row_count` | number | Range filter — buyers want a minimum |
| `price_per_day_wei` | number | Range filter — buyers want a maximum |
| `region` | string, e.g. `"EU"` | Buyers have jurisdiction constraints |
| `owner` | address | Owner dashboard queries its own listings |
| `schema_hash` | string | Buyer checks column compatibility before paying |

The buyer's browse is a **compound filter**, not single-attribute equality:

```
kind = "listing" AND domain = "fitness" AND metric = "heart_rate"
  AND row_count >= 500 AND price_per_day_wei <= 2000000000000000
```

### Payload (not queryable)

- `swarmHash` — where the ciphertext actually lives
- `sampleSwarmHash` — a small plaintext synthetic sample, so buyers can look before paying
- `columns` — column names and units
- `description` — free text

`swarmHash` is deliberately *not* an attribute. Nobody filters by content hash, and
putting it in attributes would only widen the index for no query.

## 2. `grant` — a paid licence, and the reason Arkiv is here

**The TTL is the licence.** A grant is created with a lifetime equal to the purchased
duration. Access checks are a query for a live grant. When the licence runs out the
entity expires and the query stops returning it — there is no revocation job, no
cron sweep, and no delete call anywhere in this codebase.

### Attributes (queryable)

| Attribute | Type | Why it is an attribute |
|---|---|---|
| `kind` | string, `"grant"` | — |
| `listing_id` | string | Which dataset this licenses |
| `buyer` | address | The access check filters on it |
| `owner` | address | Powers the owner's live earnings feed |
| `settlement_tx` | string | Fuji transaction that paid for it |

The access check, run before the owner's browser will train anything:

```
kind = "grant" AND listing_id = <id> AND buyer = <address>
```

Zero rows means no licence. Absence is the signal.

### Payload (not queryable)

- `jobSpec` — the model and hyperparameters the buyer asked for
- `purchasedSeconds` — what was paid for, kept for the receipt

## Expiry, both patterns

Arkiv Mission 02 lists two patterns. Vespro uses both, because a marketplace needs both.

- **Lapse as signal** — a `grant` is allowed to die. Access ends because time passed.
- **Lease / sliding expiry** — a `listing` extends its own lifetime each time it is
  renewed or transacted against. A seller who walks away stops renewing, and their
  listing quietly leaves the market without anyone running a cleanup job.

Demo lifetimes are **60 to 120 seconds**, not days. Arkiv's brief is explicit that
nobody can wait around on Sunday morning, so the boundary has to be crossable on
camera.
