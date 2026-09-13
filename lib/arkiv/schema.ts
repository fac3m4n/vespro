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
  listingId: string;
  domain: string;
  metric: string;
  rowCount: number;
  pricePerDayWei: bigint;
  region: string;
  owner: `0x${string}`;
  schemaHash: string;
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
    rowCount: i32(input.rowCount),
    pricePerDayWei: u64(input.pricePerDayWei),
    region: str(input.region),
    owner: addr(input.owner),
    schemaHash: str(input.schemaHash),
  };
}

export type ListingPayload = {
  listingId: string;
  swarmHash: string;
  sampleSwarmHash: string | null;
  columns: { name: string; unit: string }[];
  description: string;
  /** 96-bit GCM nonce, base64. Not a secret; the key never leaves the owner. */
  iv: string;
};

export type GrantInput = {
  listingId: string;
  buyer: `0x${string}`;
  owner: `0x${string}`;
  settlementTx: string;
};

/**
 * A grant is a licence whose TTL *is* its term. There is no `revoked` attribute and
 * no `expiresAt` attribute, because expiry is not application state we maintain —
 * it is the entity ceasing to exist. Nothing in this codebase deletes a grant.
 */
export function grantAttributes(input: GrantInput) {
  return {
    kind: str(KIND_GRANT),
    listingId: str(input.listingId),
    buyer: addr(input.buyer),
    owner: addr(input.owner),
    settlementTx: str(input.settlementTx),
  };
}

export type GrantPayload = {
  listingId: string;
  purchasedSeconds: number;
  jobSpec: { model: "logistic-regression"; epochs: number; learningRate: number };
};
