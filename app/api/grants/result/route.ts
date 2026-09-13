import { publishTrainingResult } from "@/lib/arkiv/entities";

/**
 * The seller returns model weights by patching them into the grant.
 *
 * Patching the grant rather than creating a result entity keeps the buyer on the
 * subscription they already have: they are watching that key, so the weights arrive
 * on the same channel as the purchase did.
 */
export async function POST(request: Request) {
  try {
    const { entityKey, result } = await request.json();

    if (!entityKey || !result) {
      return Response.json({ error: "entityKey and result are required" }, { status: 400 });
    }

    const { txHash } = await publishTrainingResult(entityKey, {
      weights: result.weights,
      bias: result.bias,
      loss: result.loss,
      rowsUsed: result.rowsUsed,
    });

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
