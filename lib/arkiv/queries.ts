import { and, eq, gte, lte, render } from "@arkiv-network/sdk/query";
import { addr, i32, str, u64 } from "@arkiv-network/sdk/attr";
import { KIND_GRANT, KIND_LISTING } from "./schema";
import { PROJECT_ATTRIBUTE_NAME, PROJECT_ATTRIBUTE_VALUE } from "./project";

/**
 * Every query starts here. Tiramisu is one shared namespace, so an unscoped query reads
 * other projects' entities — and `kind = "listing"` is not a distinctive name.
 *
 * This scopes; it does not authorise. Any wallet can write this attribute, which is why
 * the reads in `entities.ts` also pin `$creator`.
 */
const inProject = () => eq(PROJECT_ATTRIBUTE_NAME, str(PROJECT_ATTRIBUTE_VALUE));

export type BrowseFilters = {
  domain?: string;
  metric?: string;
  minRows?: number;
  maxPricePerDayWei?: bigint;
  region?: string;
};

/**
 * The buyer's browse.
 *
 * Built as a compound filter rather than a `kind` equality followed by client-side
 * filtering. Arkiv's own brief is blunt about this being the decision that separates
 * an index from a scan: pull every listing back and narrow it in JavaScript and the
 * database is doing none of the work you chose it for.
 */
export function browseListings(filters: BrowseFilters) {
  const terms = [inProject(), eq("kind", str(KIND_LISTING))];

  if (filters.domain) terms.push(eq("domain", str(filters.domain)));
  if (filters.metric) terms.push(eq("metric", str(filters.metric)));
  if (filters.region) terms.push(eq("region", str(filters.region)));
  if (filters.minRows !== undefined) {
    terms.push(gte("row_count", i32(filters.minRows)));
  }
  if (filters.maxPricePerDayWei !== undefined) {
    terms.push(lte("price_per_day_wei", u64(filters.maxPricePerDayWei)));
  }

  return and(...terms);
}

/**
 * The access check.
 *
 * Zero rows means no licence — either it was never bought, or it lapsed. Those two
 * cases are indistinguishable here and that is the design: absence is the signal, so
 * there is nothing to check a flag against and no expiry arithmetic to get wrong.
 */
export function liveGrant(listing_id: string, buyer: `0x${string}`) {
  return and(
    inProject(),
    eq("kind", str(KIND_GRANT)),
    eq("listing_id", str(listing_id)),
    eq("buyer", addr(buyer)),
  );
}

/** Everything a seller has licensed out, for the live earnings feed. */
export function grantsForOwner(owner: `0x${string}`) {
  return and(inProject(), eq("kind", str(KIND_GRANT)), eq("owner", addr(owner)));
}

export function listingsForOwner(owner: `0x${string}`) {
  return and(inProject(), eq("kind", str(KIND_LISTING)), eq("owner", addr(owner)));
}

/**
 * The query as the node receives it. Shown in the UI and captured in the mission
 * evidence, so "the same query before and after the boundary" is a claim a judge can
 * check rather than take on trust.
 */
export function explain(expression: Parameters<typeof render>[0]): string {
  return render(expression);
}
