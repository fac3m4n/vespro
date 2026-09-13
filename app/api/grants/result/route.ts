import { fetchEntity, publishTrainingResult } from "@/lib/arkiv/entities";
import { KIND_GRANT } from "@/lib/arkiv/schema";
import { clientKey, rateLimit, tooMany } from "@/lib/rateLimit";

const ENTITY_KEY = /^0x[0-9a-fA-F]{64}$/;

/**
 * The seller returns model weights by patching them into the grant.
 *
 * Patching the grant rather than creating a result entity keeps the buyer on the
 * subscription they already have: they are watching that key, so the weights arrive
 * on the same channel as the purchase did.
 *
 * There is no caller authentication here — the seller's browser holds a dataset key, not
 * a session — so the route constrains what a request can *do* instead of who may make
 * it. The target has to be a live grant this app issued, delivery happens at most once,
 * and the numbers have to look like a model. Without those, an arbitrary caller could
 * overwrite any buyer's licence payload with anything at all.
 */
export async function POST(request: Request) {
  const limit = rateLimit(clientKey(request, "results"), { limit: 20, windowSeconds: 300 });
  if (!limit.ok) return tooMany(limit);

  try {
    const { entityKey, result } = await request.json();

    if (typeof entityKey !== "string" || !ENTITY_KEY.test(entityKey)) {
      return Response.json({ error: "entityKey must be a 32-byte hex key" }, { status: 400 });
    }

    const trained = validate(result);
    if (!trained) {
      return Response.json({ error: "result is not a well-formed model" }, { status: 400 });
    }

    // Returns null for an expired entity and for one this app did not create, so an
    // unrelated key cannot be used to reach into somebody else's data.
    const grant = await fetchEntity(entityKey as `0x${string}`);
    if (!grant || grant.attributes.kind !== KIND_GRANT) {
      return Response.json({ error: "no live grant with that key" }, { status: 404 });
    }

    // Delivery is once per licence. A grant that already carries weights is a completed
    // job, and a second patch would silently replace a model the buyer may have read.
    if (grant.payload.trained) {
      return Response.json({ error: "this grant already has a model" }, { status: 409 });
    }

    const { txHash } = await publishTrainingResult(
      entityKey as `0x${string}`,
      trained,
      grant.payload,
    );

    return Response.json({ ok: true, txHash });
  } catch (error) {
    // A grant that expired mid-training cannot be patched, and that is correct
    // behaviour rather than a bug: the licence ran out before delivery.
    return Response.json(
      { error: error instanceof Error ? error.message : "unknown error" },
      { status: 409 },
    );
  }
}

/**
 * Shape and bounds, not plausibility. These land in a public entity payload, so the
 * point is that a caller cannot post something enormous or non-numeric — whether the
 * model is any *good* is the buyer's problem and visible in the loss curve.
 */
function validate(
  result: unknown,
): { weights: number[]; bias: number; loss: number[]; rowsUsed: number } | null {
  if (!result || typeof result !== "object") return null;
  const { weights, bias, loss, rowsUsed } = result as Record<string, unknown>;

  const numbers = (value: unknown, max: number): number[] | null =>
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= max &&
    value.every((n) => typeof n === "number" && Number.isFinite(n))
      ? (value as number[])
      : null;

  const w = numbers(weights, 64);
  const l = numbers(loss, 2000);

  if (!w || !l) return null;
  if (typeof bias !== "number" || !Number.isFinite(bias)) return null;
  if (typeof rowsUsed !== "number" || !Number.isSafeInteger(rowsUsed) || rowsUsed <= 0) {
    return null;
  }

  return { weights: w, bias, loss: l, rowsUsed };
}
