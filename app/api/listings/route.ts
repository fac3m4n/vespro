import { createListing, fetchListings } from "@/lib/arkiv/entities";
import { browseListings, explain } from "@/lib/arkiv/queries";
import type { BrowseFilters } from "@/lib/arkiv/queries";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const filters: BrowseFilters = {
    domain: params.get("domain") ?? undefined,
    metric: params.get("metric") ?? undefined,
    region: params.get("region") ?? undefined,
    minRows: params.get("minRows") ? Number(params.get("minRows")) : undefined,
    maxPricePerDayWei: params.get("maxPrice")
      ? BigInt(params.get("maxPrice")!)
      : undefined,
  };

  try {
    return Response.json({
      listings: await fetchListings(filters),
      // The query as the node received it, so the UI can show what was actually asked.
      query: explain(browseListings(filters)),
    });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 502 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    return Response.json(
      await createListing(
        {
          listing_id: body.listing_id,
          domain: body.domain,
          metric: body.metric,
          row_count: Number(body.row_count),
          price_per_day_wei: BigInt(body.price_per_day_wei),
          region: body.region,
          schema_hash: body.schema_hash,
        },
        {
          listing_id: body.listing_id,
          swarmHash: body.swarmHash,
          sampleSwarmHash: body.sampleSwarmHash ?? null,
          columns: body.columns ?? [],
          description: body.description ?? "",
          iv: body.iv,
        },
      ),
    );
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
