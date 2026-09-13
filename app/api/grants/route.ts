import { createGrant, hasLiveGrant } from "@/lib/arkiv/entities";
import { roleAddress } from "@/lib/arkiv/client";
import { explain, liveGrant } from "@/lib/arkiv/queries";
import { LICENCE_SECONDS, type LicenceOption } from "@/lib/arkiv/schema";
import { settleOnFuji, verifyPurchaseTx } from "@/lib/fuji";
import { clientKey, rateLimit, tooMany } from "@/lib/rateLimit";

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const LISTING_ID = /^[a-z0-9-]{3,48}$/;
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

/**
 * The access check.
 *
 * Also returns the query text, because the whole Mission 02 claim is "the same query
 * before and after the boundary, with no delete in between" — which is only checkable
 * if the caller can see that the query really did not change.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const listing_id = params.get("listing_id");
  const buyer = params.get("buyer") as `0x${string}` | null;

  if (!listing_id || !buyer) {
    return Response.json({ error: "listing_id and buyer are required" }, { status: 400 });
  }
  // Both go into a query expression, so they are constrained rather than trusted.
  if (!LISTING_ID.test(listing_id) || !ADDRESS.test(buyer)) {
    return Response.json({ error: "malformed listing_id or buyer" }, { status: 400 });
  }

  try {
    return Response.json({
      licensed: await hasLiveGrant(listing_id, buyer),
      query: explain(liveGrant(listing_id, buyer)),
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  // A purchase is a Fuji transaction plus an Arkiv write.
  const limit = rateLimit(clientKey(request, "grants"), { limit: 10, windowSeconds: 300 });
  if (!limit.ok) return tooMany(limit);

  try {
    const body = await request.json();
    const option = body.option as LicenceOption;

    if (!(option in LICENCE_SECONDS)) {
      return Response.json(
        { error: `option must be one of ${Object.keys(LICENCE_SECONDS).join(", ")}` },
        { status: 400 },
      );
    }

    const listing_id = String(body.listing_id ?? "");
    if (!LISTING_ID.test(listing_id)) {
      return Response.json({ error: "malformed listing_id" }, { status: 400 });
    }
    if (typeof body.owner !== "string" || !ADDRESS.test(body.owner)) {
      return Response.json({ error: "owner must be a 20-byte address" }, { status: 400 });
    }
    const owner = body.owner as `0x${string}`;

    // The licence belongs to whoever paid. Falling back to the shared demo buyer keeps
    // the no-wallet path working; when a wallet is connected this must be that wallet,
    // because the access check filters on it.
    const buyer: `0x${string}` =
      typeof body.buyer === "string" && ADDRESS.test(body.buyer)
        ? (body.buyer as `0x${string}`)
        : roleAddress("buyer");

    const termSeconds = LICENCE_SECONDS[option];

    // Settlement first: no licence exists unless it was paid for. When Fuji is not
    // configured this returns a clearly-labelled unsettled marker rather than
    // pretending a payment happened.
    //
    // A connected buyer pays from their own wallet, so the transaction already exists by
    // the time we get here. It is checked against the chain rather than trusted, and
    // checked to be *this* purchase — same listing, same buyer, same term — because a
    // receipt that merely proves some payment happened can be replayed against a more
    // expensive dataset or a longer term.
    const settlement = await (async () => {
      if (typeof body.settlement_tx === "string" && body.settlement_tx.startsWith("0x")) {
        if (!TX_HASH.test(body.settlement_tx)) {
          throw new Error("settlement_tx is not a 32-byte transaction hash");
        }
        const verified = await verifyPurchaseTx(body.settlement_tx as `0x${string}`, {
          listing_id,
          buyer,
          termSeconds,
        });
        if (!verified.ok) {
          throw new Error(`Settlement transaction rejected: ${verified.reason}`);
        }
        return verified.settlement;
      }
      return settleOnFuji({ listing_id, seconds: termSeconds });
    })();

    // Measured back from the end of the paid term rather than forward from now. The two
    // are the same on a first purchase and deliberately different on a replay.
    const lifetimeSeconds = settlement.termEndsAtMs
      ? Math.floor((settlement.termEndsAtMs - Date.now()) / 1000)
      : termSeconds;

    if (lifetimeSeconds < 2) {
      throw new Error("That payment's term has already elapsed; buy a new licence.");
    }

    const grant = await createGrant({
      listing_id,
      owner,
      buyer,
      option,
      settlement_tx: settlement.txHash,
      jobSpec: body.jobSpec ?? { model: "logistic-regression", epochs: 40, learningRate: 0.05 },
      lifetimeSeconds,
    });

    return Response.json({
      ...grant,
      settlement,
      // The chain's clock where there is one, the server's otherwise — never the
      // browser's, which would drift and could show time left on a lapsed licence.
      expiresAtMs: settlement.termEndsAtMs ?? Date.now() + grant.lifetimeSeconds * 1000,
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
