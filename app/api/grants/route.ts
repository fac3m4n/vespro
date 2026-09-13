import { createGrant, hasLiveGrant } from "@/lib/arkiv/entities";
import { explain, liveGrant } from "@/lib/arkiv/queries";
import { LICENCE_SECONDS, type LicenceOption } from "@/lib/arkiv/schema";
import { settleOnFuji } from "@/lib/fuji";
import { clientKey, rateLimit, tooMany } from "@/lib/rateLimit";

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

    // Settlement first: no licence exists unless it was paid for. When Fuji is not
    // configured this returns a clearly-labelled unsettled marker rather than
    // pretending a payment happened.
    const settlement = await settleOnFuji({
      listing_id: body.listing_id,
      seconds: LICENCE_SECONDS[option],
    });

    const grant = await createGrant(
      body.listing_id,
      body.owner,
      option,
      settlement.txHash,
      body.jobSpec ?? { model: "logistic-regression", epochs: 40, learningRate: 0.05 },
    );

    return Response.json({
      ...grant,
      settlement,
      // The term is measured from the server's clock, not the browser's. A countdown
      // driven by the client would drift against the chain and could show time left on
      // a licence that has already lapsed.
      expiresAtMs: Date.now() + grant.purchasedSeconds * 1000,
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
