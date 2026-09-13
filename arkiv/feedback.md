# Arkiv feedback report

Vespro, ETHRome 2026. Built against `@arkiv-network/sdk@0.8.1` on Tiramisu
(chain `7738577`), Node 24.19, Next.js 16.3.5.

Ordered by how much it cost us, not by severity. Every item is something we hit
while building, with the reproduction where there is one.

---

## 1. The SDK README publishes a working private key

**Severity: worth fixing before more people copy it.**

`node_modules/@arkiv-network/sdk/README.md`, in the wallet client section:

> For quick testing, you may use this example key:
> `0x3d05798f7d…` _(32 bytes, redacted here — it is in your README verbatim)_

We have deliberately truncated it rather than reproduce it. It is already public,
so quoting it in full would disclose nothing new, but a 64-character hex key in a
public repository trips secret scanners and trains the next reader that this is
normal. The finding is still checkable: it is in `README.md` of the published
package, in the "Note" under the wallet client example.

Two separate problems, and the second is the one that lasts.

The immediate one is that this is a shared hot wallet. Anyone who has read the
docs can spend anything sent to it, and anyone can grief it by draining the
faucet balance a newcomer just requested — so the "quick testing" path is also
the flakiest one, in a way that looks like the network is broken rather than like
the key is public.

The durable one is that it appears three lines under `privateKeyToAccount('0x...')`
in a snippet the reader is being told to paste a key into. The first thing the SDK
teaches is putting a private key in source. We would suggest reading it from
`process.env` in the example itself, which costs one line and teaches the opposite:

```ts
account: privateKeyToAccount(process.env.ARKIV_PRIVATE_KEY as `0x${string}`),
```

We did not use the published key. Vespro generates burners with a CSPRNG, keeps
them in a gitignored `.env.local`, and refuses to start if they are missing.

## 2. `watchEntityEvents` polls over an http transport and never says so

**Severity: this is the whole of Mission 03, and it is invisible.**

This is the footgun the mission brief hints at, and it is worse at the call site
than we expected. Both of these compile, both run, both fire the same handlers,
and both look identical in a two-window demo:

```ts
// A real server-pushed subscription.
createPublicClient({ chain: tiramisu, transport: webSocket(WS_URL) })
  .watchEntityEvents({ onEvent })

// A one-second polling loop. Same handler, same events, no warning.
createPublicClient({ chain: tiramisu, transport: http(HTTP_URL) })
  .watchEntityEvents({ onEvent })
```

Nothing in the types, the return value or the handler signature distinguishes
them. `WatchEntityEventsParameters` documents `pollingInterval` as "How often to
poll, in milliseconds. Defaults to half a block", which tells you polling exists
but not that the transport alone decides whether you are doing it.

The trap compounds with `fromBlock`. Its docstring reads "Replay from this block
before following the head", which makes it sound like the correct way to recover
after a dropped socket — and reaching for it silently converts a working
subscription into a poll. So the instinct that a robust implementation should
backfill is precisely the instinct that breaks the subscription.

**What we would change.** Either warn once via the `debug` namespace when
`watchEntityEvents` is called on a non-websocket transport, or return the mode on
the watcher handle so a caller can assert on it. One line in the docstring —
"over an `http` transport this polls; pass a `webSocket` transport for a real
subscription" — would have saved us the most confusing twenty minutes of the
build.

**How Vespro works around it.** `lib/arkiv/client.ts` refuses to construct a
subscription client without `NEXT_PUBLIC_ARKIV_RPC_WS`, with no http fallback,
because a silent downgrade to polling is worse than a startup crash.
`lib/useEntityStream.ts` reads `client.transport.type` and the UI only claims to
be live when it is literally `"webSocket"`. We never pass `fromBlock`; a gap is
reconciled with a one-shot `select()` over http instead, which keeps the socket
doing only what a socket is good at.

## 3. `getEntity` throws for an expired entity

**Severity: minor, but it shapes expiry-centric code.**

`getEntity` raises `NoEntityFoundError` when an entity "never existed, or was
deleted or has expired". For a product where expiry is the mechanism, that means
the single most common, most expected outcome arrives as an exception:

```ts
// Reading a lapsed licence is normal control flow, not an error.
try {
  return await client.getEntity(grantKey);
} catch {
  return null;
}
```

Collapsing the three cases is right — Vespro genuinely does not want to
distinguish "expired" from "never existed", and we say so in our schema. But a
`getEntityOrNull` (or a `{ throwOnMissing: false }` option) would let expiry read
as a value rather than as a thrown thing. Queries already behave this way, which
is why `select().limit(1)` ended up being our access check instead.

## 4. Duration helpers reject odd numbers of seconds, at runtime

**Severity: minor. The strictness is right, the timing is not.**

`ExpirationTime.fromSeconds(61)` throws `InvalidExpiryError`, because lifetimes
are counted in 2-second blocks and 61 seconds is not a whole number of them. We
agree with refusing to silently round — the docstring's reasoning about not
turning a caller's `3` into four seconds is exactly right, and we wish more SDKs
did this.

What cost us time is that it surfaces at runtime, from a literal. Our first
licence tier was 90 seconds, which is fine, and our second was 45, which is not,
and the two are indistinguishable at the call site. If `fromSeconds` took an even
number at the type level, or the error named the two nearest valid values, this
would be a compile-time nudge instead of a runtime surprise.

Related, and genuinely useful: `resolveExpiry` returning `target` so the block a
duration actually resolved to is observable. Documenting durations as approximate
rather than pretending blocks are a clock is the right call, and it let us show a
real expiry block in the UI instead of our own guess.

## 5. Docs: stray space in the Tiramisu import, and a version that has moved on

**Severity: cosmetic, but it is a copy-paste target.**

On <https://docs.arkiv.network/networks/tiramisu/>, the connect snippet reads:

```ts
import { http } from " viem"
```

The leading space inside the string breaks the import if pasted verbatim.

Separately, the ETHRome hacker manual pins `@arkiv-network/sdk` at "v0.7.x" and
the SDK README's own install example shows `"@arkiv-network/sdk": "^0.6.0"`, while
npm currently ships **0.8.1**. Not harmful, but three numbers in three places is
one more thing to second-guess at 4am. The manual explicitly says your ETHRome
page wins on disagreements, so this is mostly a note for whoever refreshes the
README example.

## 6. What worked well enough to be worth saying

Not padding — these are the things that made a 6-hour build possible.

- **`select()` field projection with inferred result types.** Reading a field you
  did not select is a compile error, which caught two real mistakes for us. The
  documented footgun about a selection stored in a variable widening `true` to
  `boolean` is the kind of note that only exists because someone got burned, and
  it saved us from getting burned the same way.
- **Being viem-shaped.** `createPublicClient` / `createWalletClient` / transports
  meant there was effectively nothing to learn about client construction. Our
  Fuji settlement path and our Arkiv path are the same code with a different chain.
- **Tagged attribute constructors.** `i32`, `u64`, `addr`, `str` making the type
  explicit at the write site meant our attribute schema was self-documenting, and
  `render()` on an expression turned out to be the single best debugging tool in
  the SDK — we ended up showing its output in the product itself, because "here is
  the query the node ran" is more convincing than any screenshot.
- **The attributes-versus-payload split being a forced decision.** It made us
  actually design an index instead of dumping a document in and hoping. Our
  `arkiv/schema.md` exists because the SDK would not let us avoid the question.

## 7. Where Arkiv earned its place in this app

For the record, since "why Arkiv" is the question the bounty asks.

Vespro sells time-limited licences to encrypted datasets. Two things it needs are
things a Web2 database does not give us for free.

**Queryable metadata over content-addressed blobs.** Swarm returns a content
hash. It cannot answer "fitness datasets, heart-rate metric, at least 500 rows,
under this price, EU only" — that is a compound filter over typed attributes, and
it is the whole browse experience. Arkiv is the index; Swarm is where the bytes
live. That division is exactly what your docs describe, and it is the first time
the "not file storage" framing landed for us as a feature rather than a caveat.

**Expiry as the licence, not as a column.** A grant's TTL *is* its term. There is
no `expiresAt` column, no revocation flag, no cron sweep, and no `delete` call
anywhere in this codebase — access ends because the entity stops existing, and the
access check is the same query before and after. On Postgres this is a scheduled
job that can fail, lag, or be forgotten, and a `WHERE expires_at > now()` that
someone eventually omits. Here the database's own semantics enforce the contract.
That is the part we would not want to give back.
