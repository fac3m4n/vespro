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
          listingId: body.listingId,
          domain: body.domain,
          metric: body.metric,
          rowCount: Number(body.rowCount),
          pricePerDayWei: BigInt(body.pricePerDayWei),
          region: body.region,
          schemaHash: body.schemaHash,
        },
        {
          listingId: body.listingId,
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
