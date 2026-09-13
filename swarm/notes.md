# Swarm notes — Vespro

Built against `@snaha/swarm-id@0.4.1`. Swarm holds every dataset in this app, as
ciphertext.

## Why Swarm, and not our own bucket

Vespro's claim is that no platform holds your data. If the bytes were in our S3
bucket that would be a promise about our conduct; with Swarm it is a property of the
system, because **there is no server-side upload path in this codebase to abuse.**
Encryption and upload both happen in the seller's tab, and the only thing our backend
ever sees is a content hash.

Swarm ID is what made that possible in a weekend. Running a funded Bee node and
buying a postage batch before writing any code would have put xBZZ and xDAI on the
critical path; instead stamps are signed in the browser and batch state is read from
Gnosis directly. `lib/swarm.ts` is the whole integration.

Content addressing does a second job we did not anticipate: the Swarm hash recorded in
an Arkiv listing pins exactly which bytes were licensed, so a seller cannot swap the
dataset out from under a buyer after settlement.

## What we actually used

`@snaha/swarm-id@0.4.1`, and four methods: `connect()`, `uploadData()`,
`downloadData()`, `getPostageBatch()`. Plus the public gateway's HTTP API for the
verification links in the app's evidence panel.

Not used, so as not to overclaim: bee-js directly, Feeds, feed manifests, ACT,
`swarm-cli`, and Swarm website hosting. The app is on Vercel because it needs server
routes to hold signing keys; only the datasets are on Swarm.

## Feedback

### `/bzz` answers 308 for a raw-bytes reference, so a working upload looks broken

`uploadData()` stores raw bytes, which are retrievable at `/bytes/<ref>`. We built our
verification links against `/bzz/<ref>` — the endpoint every example and gateway URL
shows — and got a 308 redirect and no data. It looked exactly like a failed upload, and
we spent time hunting a bug in our own encryption before testing the other endpoint:

```
curl -s -o /dev/null -w "%{http_code}" https://download.gateway.ethswarm.org/bzz/<ref>
308
curl -s -o /dev/null -w "%{http_code}" https://download.gateway.ethswarm.org/bytes/<ref>
200
```

`/bzz` resolves a manifest, and a bytes reference has none — that is reasonable once you
know it. The gap is that nothing connects the upload method to its matching download
endpoint. `uploadData()`'s docs could say "retrieve at `/bytes`", or the 308 could carry a
body explaining that the reference is not a manifest. A one-line note next to
`uploadData`/`uploadFile` would have saved us twenty minutes at 6am.

### Postage batch capacity is hard to report honestly

We wanted to show a seller how much room is left. `getPostageBatch()` returns
`utilization`, `depth` and `bucketDepth`, and turning those into "bytes free" means
knowing that the bucket count is `2^(depth - bucketDepth)` and capacity is
`2^depth * 4096`. We got there, but two things are easy to get wrong and we suspect most
apps do:

- `utilization` is not a percentage or a byte count, and nothing in the type says so.
- `2^depth * 4096` is a *theoretical* ceiling. Chunks land in buckets by hash, so a batch
  stops accepting uploads when a single bucket fills — well before the nominal figure. An
  app that prints it as "free space" is overstating what the user has. Ours now labels it
  theoretical and shows the bucket counts alongside, which felt like the only honest option.

A helper on the client — `bytesUsed` / `bytesRemaining`, or an `effectiveCapacity` that
accounts for bucket distribution — would stop everyone reimplementing this from the Bee
source, and getting it subtly wrong in different ways.

### A global `message` listener warns on every unrelated postMessage

**A global `message` listener warns on every unrelated postMessage.**

`SwarmIdClient.setupMessageListener` attaches a `window` listener that rejects any
message whose origin is not `iframeOrigin`, and `console.warn`s each time:

```
[SwarmIdClient] Rejected message from unauthorized origin: http://localhost:3000
```

The origin check is correct. The problem is that the listener sees *all* postMessages
on the page, including ones that were never meant for it — under Next.js dev, HMR
traffic triggers it several times a second, and any app with an analytics script or an
embedded widget will see the same. It looks alarming ("unauthorized origin" reads like
a security event) while being entirely benign, and it buries real warnings.

Suggestion: return silently when the origin does not match, or shape-check the payload
before deciding a message is one of yours and worth complaining about. Warning at
`debug` level would also be fine.

Nothing functional broke, and uploads and retrieval worked first time once a postage
batch was available.

## Small thing that cost us a minute

`canUpload` being `false` for a *connected* identity with no postage batch is the right
model, but the failure otherwise appears much later as a rejected upload. We surface it
up front in `lib/swarm.ts` with the reason spelled out, and `npm run check` reports it
before the demo rather than during it.

## Where we would take it next

Swarm's access control (ACT) instead of our own AES key management, so grant and revoke
become Swarm-native operations keyed by the buyer's public key. That would let a licence
be enforced at the storage layer as well as at the index, and would remove the one piece
of key handling we are least happy about — a raw exported key in `localStorage`.
