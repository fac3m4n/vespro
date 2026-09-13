import { addr, i32, str, u64 } from "@arkiv-network/sdk/attr";

export const KIND_LISTING = "listing";
export const KIND_GRANT = "grant";

/**
 * Demo lifetimes, in seconds. Arkiv counts lifetimes in blocks at 2s each, so every
 * value here has to be an even number or the SDK rejects it outright.
 *
 * These are deliberately tiny. A licence measured in days cannot be shown expiring
 * during a judging slot, and expiry is the thing we are trying to show.
 */
export const LICENCE_SECONDS = {
  "60s": 60,
  "2min": 120,
  "10min": 600,
} as const;

export type LicenceOption = keyof typeof LICENCE_SECONDS;

/** A listing renews in bigger steps than a grant — it is a shopfront, not a lease. */
export const LISTING_LIFETIME_SECONDS = 900;

export type ListingInput = {
  listing_id: string;
  domain: string;
  metric: string;
  row_count: number;
  price_per_day_wei: bigint;
  region: string;
  owner: `0x${string}`;
  schema_hash: string;
};

/**
 * Attributes are the queryable surface, and nothing else is. Every field here exists
 * because a buyer filters or sorts on it.
 *
 * `swarmHash` is absent on purpose: nobody browses by content hash, so indexing it
 * would widen the index without enabling a single query. It lives in the payload.
 */
export function listingAttributes(input: ListingInput) {
  return {
    kind: str(KIND_LISTING),
    domain: str(input.domain),
    metric: str(input.metric),
    row_count: i32(input.row_count),
    price_per_day_wei: u64(input.price_per_day_wei),
    region: str(input.region),
    owner: addr(input.owner),
    schema_hash: str(input.schema_hash),
  };
}

export type ListingPayload = {
  listing_id: string;
  swarmHash: string;
  sampleSwarmHash: string | null;
  columns: { name: string; unit: string }[];
  description: string;
  /** 96-bit GCM nonce, base64. Not a secret; the key never leaves the owner. */
  iv: string;
};

export type GrantInput = {
  listing_id: string;
  buyer: `0x${string}`;
  owner: `0x${string}`;
  settlement_tx: string;
};

/**
 * A grant is a licence whose TTL *is* its term. There is no `revoked` attribute and
 * no `expiresAt` attribute, because expiry is not application state we maintain —
 * it is the entity ceasing to exist. Nothing in this codebase deletes a grant.
 */
export function grantAttributes(input: GrantInput) {
  return {
    kind: str(KIND_GRANT),
    listing_id: str(input.listing_id),
    buyer: addr(input.buyer),
    owner: addr(input.owner),
    settlement_tx: str(input.settlement_tx),
  };
}

export type GrantPayload = {
  listing_id: string;
  purchasedSeconds: number;
  jobSpec: { model: "logistic-regression"; epochs: number; learningRate: number };
};
