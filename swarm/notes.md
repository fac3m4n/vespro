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

## One piece of feedback

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
