# Vespro — 3 minute demo script

Untracked on purpose. Not committed, not pushed.

**Hard rules from the manual:** landscape, your face on camera, and the link must open
without a login — check it in a private window before you submit.

---

## The one timing decision that matters

Buy the **60s** licence early, then keep talking. The countdown runs while you narrate the
architecture, and you come back to it at 2:30 to show it lapse. If you buy it late you
will be sitting in silence waiting for a bar to empty, and that is a third of your video.

Measured, so you can plan around it: publishing takes about 9 seconds plus one MetaMask
confirm, and buying takes about 8 seconds plus one more. Budget ~15s of dead air per
transaction and talk through it — the lines below are written to cover exactly that.

---

## Pre-flight — do all of this before you hit record

- [ ] Two browser windows, side by side. **Left = Sell data. Right = Marketplace.**
- [ ] MetaMask unlocked, on Fuji, with test AVAX. Unlock it *now* — a locked wallet shows
      "Unlock wallet" and costs you a take.
- [ ] Swarm ID connected on the left window; the storage bar should be visible.
- [ ] Publish one throwaway listing and let it work, so you know the path is live. Then
      clear the evidence panel.
- [ ] Zoom the browser to ~125% so text is readable when the video is compressed.
- [ ] Close anything with notifications.

**Same wallet on both sides is fine and intended.** You are the seller and the buyer, so
the payment is circular — the app labels the payee "you" so it doesn't look like a mistake.
Say it out loud once and move on.

---

## 0:00 – 0:20 · The problem

*On camera, face visible.*

> "If you own data worth training on, you have two options today. Upload it to a platform
> that takes a cut and keeps a copy, or don't sell it at all.
>
> Vespro is a third option. Buyers train on your data and never receive it. I'll show the
> whole loop in under three minutes, on live testnets."

## 0:20 – 0:55 · Sell without handing anything over

*Left window. Click "Use synthetic wearables", then Encrypt, upload and list.*

> "Eight hundred rows of wearable data. It's encrypted right here in the browser with
> AES-256-GCM — the key is generated in this tab and never leaves it. Not to my server,
> because there isn't one in this path.
>
> What goes to Swarm is ciphertext. What goes to Arkiv is the index — row count, region,
> the schema hash, the price. Everything a buyer needs to decide, and nothing that is the
> data."

*MetaMask opens. Confirm.*

> "That's Fuji. I'm signing the terms myself, so the contract records my address as the
> payee. The price a buyer pays is published before anyone can pay it."

## 0:55 – 1:30 · Buy a licence — start the clock

*Right window. Set minimum rows, apply filters. Point at the query block.*

> "That's the actual query Arkiv evaluated. One compound filter on typed attributes —
> not a scan I narrowed in JavaScript afterwards."

*Click the 60s licence. Confirm in MetaMask.*

> "Sixty seconds of access, about thirty-five millionths of an AVAX, settled on Fuji."

**The countdown is now running. Do not wait for it.**

## 1:30 – 2:05 · The model arrives, pushed

*Weights appear on the right on their own.*

> "I never clicked refresh. The seller's tab was watching an Arkiv subscription over a
> websocket, woke up when my licence appeared, pulled the ciphertext from Swarm, decrypted
> it locally, trained, and sent back weights.
>
> That badge is showing the live transport, because over HTTP the same call silently
> becomes a one-second poll and looks identical. This one refuses to run unless it's a
> real socket.
>
> I have a model. I never had the rows, and I never had the key."

## 2:05 – 2:35 · Why these three, briefly

*Evidence panel. Click the Swarm link.*

> "Every transaction from this session, with links. This one is the dataset on a public
> Swarm gateway — anyone can fetch it and get noise, which is the point.
>
> Swarm holds bytes it cannot read. Fuji holds the money and the rule. Arkiv holds the
> licence — and this is the part I'd point at."

## 2:35 – 2:55 · Expiry, with no delete anywhere

*Countdown hits zero. Click Run access check.*

> "The licence just lapsed. Same query as before, and now it matches nothing.
>
> Nothing revoked it. There is no delete call in this codebase, no expiry column, no
> status flag. The grant is an Arkiv entity whose lifetime *is* the term that was paid
> for. When the term ends the entity is gone, so access ends because there is nothing
> left to find."

## 2:55 – 3:00 · Close

*Back to camera.*

> "Encrypted on Swarm, licensed on Arkiv, settled on Avalanche. Vespro."

---

## If something fails live

- **MetaMask doesn't appear** — it's behind the browser window. Alt-tab.
- **Marketplace is empty** — listings expire after 15 minutes by design. Say so, it's the
  same mechanism as the licences, then republish.
- **Weights don't arrive** — check the transport badge says `webSocket`. If it doesn't, the
  websocket env var is missing on that deployment.
- **You overrun** — cut section 2:05–2:35. The expiry moment is the one thing that cannot
  be cut; it's the whole Mission 02 claim.

## Numbers, if you're asked

- 800 rows, 4 columns, logistic regression, one round
- 60s licence at 0.05 AVAX/day ≈ 0.0000347 AVAX
- Arkiv Tiramisu, chain `7738577`, 2-second blocks
- Contract `0x3e4e5bf72803e2d18d313613fa2f16662de94b29`, verified on Snowtrace

## Say this if a judge asks "is it really private?"

Be straight about it — the honest version is stronger than the pitch:

> "The buyer never gets the rows or the key, and that holds. But this is federated
> training, not training under encryption — the owner's own browser decrypts and trains,
> so the owner is trusted with their own data. The weights are also a real disclosure
> surface: with one participant and no differential privacy, they leak something about the
> inputs. What's demonstrated is that plaintext never crosses the network and access is
> enforced by a licence that expires on its own."
