import { createListing, fetchListings } from "@/lib/arkiv/entities";
import { browseListings, explain } from "@/lib/arkiv/queries";
import type { BrowseFilters } from "@/lib/arkiv/queries";
import { registerTermsOnFuji } from "@/lib/fuji";
import { LICENCE_SECONDS } from "@/lib/arkiv/schema";

const DOMAINS = ["fitness"] as const;
const METRICS = ["heart_rate", "sleep", "steps"] as const;
const REGIONS = ["EU", "US", "APAC"] as const;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const filters: BrowseFilters = {
    domain: allowed(params.get("domain"), DOMAINS),
    metric: allowed(params.get("metric"), METRICS),
    region: allowed(params.get("region"), REGIONS),
    minRows: positiveInt(params.get("minRows")),
    maxPricePerDayWei: positiveBigInt(params.get("maxPrice")),
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

    const listing_id = String(body.listing_id ?? "");
    // Becomes part of an Arkiv attribute and a Solidity string key, so it is
    // constrained rather than trusted.
    if (!/^[a-z0-9-]{3,48}$/.test(listing_id)) {
      return Response.json(
        { error: "listing_id must be 3-48 chars of a-z, 0-9 and hyphen" },
        { status: 400 },
      );
    }

    const domain = allowed(body.domain, DOMAINS);
    const metric = allowed(body.metric, METRICS);
    const region = allowed(body.region, REGIONS);
    if (!domain || !metric || !region) {
      return Response.json({ error: "domain, metric and region must be known values" }, { status: 400 });
    }

    const row_count = positiveInt(body.row_count);
    const price_per_day_wei = positiveBigInt(body.price_per_day_wei);
    if (!row_count || price_per_day_wei === undefined) {
      return Response.json({ error: "row_count and price_per_day_wei are required" }, { status: 400 });
    }

    const schema_hash = String(body.schema_hash ?? "");
    if (!/^sha256:[0-9a-f]{64}$/.test(schema_hash)) {
      return Response.json({ error: "schema_hash must be sha256:<64 hex>" }, { status: 400 });
    }

    // The asset rule goes onchain before the listing becomes visible, so the terms a
    // buyer pays under are published ahead of any purchase. A failure here does not
    // block listing the dataset — it only means this one cannot be settled, which the
    // response reports rather than hides.
    let terms;
    try {
      terms = await registerTermsOnFuji({
        listing_id,
        price_per_day_wei,
        minSeconds: Math.min(...Object.values(LICENCE_SECONDS)),
        maxSeconds: Math.max(...Object.values(LICENCE_SECONDS)),
        schemaCommitment: `0x${schema_hash.slice("sha256:".length)}`,
      });
    } catch (error) {
      terms = { registered: false, txHash: null, note: message(error) };
    }

    const listing = await createListing(
      { listing_id, domain, metric, row_count, price_per_day_wei, region, schema_hash },
      {
        listing_id,
        swarmHash: String(body.swarmHash ?? ""),
        sampleSwarmHash: body.sampleSwarmHash ?? null,
        columns: Array.isArray(body.columns) ? body.columns : [],
        description: String(body.description ?? "").slice(0, 500),
        iv: String(body.iv ?? ""),
      },
    );

    return Response.json({ ...listing, terms });
  } catch (error) {
    return Response.json({ error: message(error) }, { status: 400 });
  }
}

function allowed<T extends readonly string[]>(
  value: unknown,
  options: T,
): T[number] | undefined {
  return typeof value === "string" && (options as readonly string[]).includes(value)
    ? (value as T[number])
    : undefined;
}

function positiveInt(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function positiveBigInt(value: unknown): bigint | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  try {
    const parsed = BigInt(String(value));
    return parsed >= 0n ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "unknown error";
}
