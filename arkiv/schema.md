# Arkiv data model — Vespro

Two entity types. The split between **attributes** (queryable) and **payload** (not
queryable) is the whole design: anything a buyer filters on has to be an attribute,
or every browse turns into a scan.

Nothing here contains a fitness measurement. The rows live encrypted on Swarm and
are never uploaded anywhere else. Arkiv entities are public and verifiable by
design, so they carry commitments and coarse metadata only.

## 1. `listing` — a dataset offered for training

Long-lived. Renewed by the owner while the listing should stay visible; if the
owner stops renewing, the listing drops out of the marketplace on its own.

### Attributes (queryable)

| Attribute | Type | Why it is an attribute |
|---|---|---|
| `kind` | string, `"listing"` | Separates the two entity types in every query |
| `domain` | string, e.g. `"fitness"` | First filter a buyer applies |
| `metric` | string, e.g. `"heart_rate"` | Narrows to a trainable signal |
| `rowCount` | number | Range filter — buyers want a minimum |
| `pricePerDayWei` | number | Range filter — buyers want a maximum |
| `region` | string, e.g. `"EU"` | Buyers have jurisdiction constraints |
| `owner` | address | Owner dashboard queries its own listings |
| `schemaHash` | string | Buyer checks column compatibility before paying |

The buyer's browse is a **compound filter**, not single-attribute equality:

```
kind = "listing" AND domain = "fitness" AND metric = "heart_rate"
  AND rowCount >= 500 AND pricePerDayWei <= 2000000000000000
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
| `listingId` | string | Which dataset this licenses |
| `buyer` | address | The access check filters on it |
| `owner` | address | Powers the owner's live earnings feed |
| `settlementTx` | string | Fuji transaction that paid for it |

The access check, run before the owner's browser will train anything:

```
kind = "grant" AND listingId = <id> AND buyer = <address>
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
