import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { arkivReadClient, arkivWriteClient, roleAddress, trustedCreator } from "./client";
import {
  LICENCE_SECONDS,
  LISTING_LIFETIME_SECONDS,
  type GrantPayload,
  type LicenceOption,
  type ListingInput,
  type ListingPayload,
  grantAttributes,
  listingAttributes,
} from "./schema";
import {
  browseListings,
  grantsForOwner,
  listingsForOwner,
  liveGrant,
  type BrowseFilters,
} from "./queries";

export type CreatedEntity = { entityKey: `0x${string}`; txHash: string };

/**
 * Arkiv measures a lifetime in blocks of two seconds, so an odd number of seconds is
 * rejected outright. Rounding *down* keeps a licence from ever outliving what was paid
 * for, and the floor of one block keeps a nearly-elapsed term from becoming a
 * zero-lifetime entity the engine would refuse.
 */
function evenSeconds(seconds: number): number {
  const floored = Math.floor(seconds);
  return Math.max(2, floored - (floored % 2));
}

export async function createListing(
  meta: Omit<ListingInput, "owner">,
  payload: ListingPayload,
): Promise<CreatedEntity> {
  const client = arkivWriteClient("owner");
  const owner = client.account.address;

  const { entityKey, txHash } = await client.createEntity({
    payload: jsonToPayload(payload),
    contentType: "application/json",
    attributes: listingAttributes({ ...meta, owner }),
    // A shopfront, not a lease. Renewed while the seller still wants to sell.
    expires: ExpirationTime.fromSeconds(LISTING_LIFETIME_SECONDS),
  });

  return { entityKey, txHash };
}

/**
 * Sells a licence.
 *
 * The purchased duration goes straight into the entity's lifetime. There is no
 * `expiresAt` column to compare against a clock, because the licence term is not
 * data we store about the grant — it is how long the grant exists.
 *
 * Two things are deliberate about who writes this entity and how long it lives.
 *
 * It is written by the **owner** wallet, not the buyer's. Only an entity's owner may
 * patch it, and the party that has to patch a grant is the seller, delivering model
 * weights after training. Creating it as the buyer produced a grant the seller could
 * not write into, so the weights never arrived. The licensee is still recorded — in the
 * `buyer` attribute, which is what the access check filters on.
 *
 * `lifetimeSeconds` is derived from the settlement, not from the moment of this call.
 * It is the time remaining on the term that was actually paid for onchain, so
 * re-presenting a settlement transaction cannot extend access: the second grant expires
 * at the same instant as the first.
 */
export async function createGrant(input: {
  listing_id: string;
  owner: `0x${string}`;
  /**
   * The address the licence is for. When a real wallet paid it must be that wallet —
   * the access check queries on this attribute, so getting it wrong would grant the
   * licence to someone who never paid.
   */
  buyer: `0x${string}`;
  option: LicenceOption;
  settlement_tx: string;
  jobSpec: GrantPayload["jobSpec"];
  /** Remaining seconds on the paid term. Becomes the entity's Entity Expiration. */
  lifetimeSeconds: number;
}): Promise<
  CreatedEntity & { purchasedSeconds: number; buyer: `0x${string}`; lifetimeSeconds: number }
> {
  const { listing_id, owner, buyer, option, settlement_tx, jobSpec } = input;
  const client = arkivWriteClient("owner");
  const purchasedSeconds = LICENCE_SECONDS[option];
  const lifetimeSeconds = evenSeconds(input.lifetimeSeconds);

  const payload: GrantPayload = { listing_id, purchasedSeconds, jobSpec };

  const { entityKey, txHash } = await client.createEntity({
    payload: jsonToPayload(payload),
    contentType: "application/json",
    attributes: grantAttributes({ listing_id, buyer, owner, settlement_tx }),
    expires: ExpirationTime.fromSeconds(lifetimeSeconds),
  });

  return { entityKey, txHash, purchasedSeconds, buyer, lifetimeSeconds };
}

/**
 * The lease half of the expiry story: renewing a listing slides its expiry forward.
 * A seller who stops renewing leaves the market on their own, and no cleanup job
 * anywhere in this system had to notice.
 */
export async function renewListing(entityKey: `0x${string}`) {
  const client = arkivWriteClient("owner");
  return client.extendEntity({
    entityKey,
    expires: ExpirationTime.fromSeconds(LISTING_LIFETIME_SECONDS),
  });
}

/**
 * The owner returns model weights by patching them into the grant they were computed
 * for. The buyer is already subscribed to that entity, so the result arrives on the
 * same channel as everything else and no new entity type is needed.
 *
 * This is why grants are created by the owner wallet: patching is an owner-only
 * operation, and the owner is the party with the model to deliver.
 */
export async function publishTrainingResult(
  entityKey: `0x${string}`,
  result: { weights: number[]; bias: number; loss: number[]; rowsUsed: number },
  /**
   * The grant's current payload. Merged rather than replaced, because patching a payload
   * overwrites the whole thing and the licence receipt — term and job spec — lives there
   * too. Replacing it left a delivered grant with no record of what was bought.
   */
  existingPayload: Record<string, unknown> = {},
) {
  const client = arkivWriteClient("owner");
  return client.patchEntity({
    entityKey,
    payload: jsonToPayload({
      ...existingPayload,
      trained: result,
      completedAt: Date.now(),
    }),
    contentType: "application/json",
  });
}

export async function fetchListings(filters: BrowseFilters) {
  const client = arkivReadClient();
  const result = await client
    .select({ key: true, owner: true, attributes: true, payload: true, expiresAt: true })
    .where(browseListings(filters))
    // Otherwise any funded wallet can publish a listing carrying our project attribute
    // and a Swarm hash of its choosing, and it appears in the buyer's browse as ours.
    .createdBy(trustedCreator())
    .limit(50)
    .fetch();

  return result.entities.map((entity) => ({
    key: entity.key,
    owner: entity.owner,
    expiresAt: entity.expiresAt.toString(),
    attributes: flatten(entity.attributes),
    payload: entity.toJson() as ListingPayload,
  }));
}

/**
 * Is there a licence right now?
 *
 * Deliberately returns a boolean and nothing else. There is no "expired" case to
 * report, because an expired grant is not a grant in a different state — it is a row
 * the query no longer returns.
 *
 * The `$creator` filter is load-bearing rather than defensive tidying. Attributes are
 * writable by anyone holding gas, so on attributes alone this check is satisfied by any
 * wallet that writes `kind=grant, buyer=<itself>` — a licence forged for the price of a
 * Tiramisu transaction. `$creator` is immutable, so scoping to the wallet that issues
 * grants is what makes a matching entity evidence of a settled purchase.
 */
export async function hasLiveGrant(
  listing_id: string,
  buyer: `0x${string}`,
): Promise<boolean> {
  const client = arkivReadClient();
  const result = await client
    .select({ key: true })
    .where(liveGrant(listing_id, buyer))
    .createdBy(trustedCreator())
    .limit(1)
    .fetch();
  return result.entities.length > 0;
}

export async function fetchOwnerGrants(owner: `0x${string}`) {
  const client = arkivReadClient();
  const result = await client
    .select({ key: true, attributes: true, payload: true, expiresAt: true })
    .where(grantsForOwner(owner))
    .createdBy(trustedCreator())
    .limit(50)
    .fetch();

  return result.entities.map((entity) => ({
    key: entity.key,
    expiresAt: entity.expiresAt.toString(),
    attributes: flatten(entity.attributes),
    payload: entity.toJson() as GrantPayload,
  }));
}

export async function fetchOwnerListings(owner: `0x${string}`) {
  const client = arkivReadClient();
  const result = await client
    .select({ key: true, attributes: true, expiresAt: true })
    .where(listingsForOwner(owner))
    .createdBy(trustedCreator())
    .limit(50)
    .fetch();

  return result.entities.map((entity) => ({
    key: entity.key,
    expiresAt: entity.expiresAt.toString(),
    attributes: flatten(entity.attributes),
  }));
}

/**
 * One entity by key.
 *
 * `getEntity` throws rather than returning null when the entity has expired, which is
 * the correct shape for Vespro: a lapsed grant is not a grant with a flag set, so the
 * caller gets `null` and treats it as no licence.
 *
 * A lookup by key cannot be scoped with `.createdBy()`, so the creator is compared here
 * instead. Without it this is the one read that would hand a caller an arbitrary
 * stranger's entity — and it backs `/api/grants/detail`, which the seller's page trusts
 * enough to start decrypting a dataset on.
 */
export async function fetchEntity(entityKey: `0x${string}`) {
  const client = arkivReadClient();
  try {
    const entity = await client.getEntity(entityKey);
    if (entity.creator.toLowerCase() !== trustedCreator().toLowerCase()) return null;
    return {
      key: entity.key,
      owner: entity.owner,
      creator: entity.creator,
      expiresAt: entity.expiresAt.toString(),
      attributes: flatten(entity.attributes),
      payload: entity.toJson() as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

export function addresses() {
  return { owner: roleAddress("owner"), buyer: roleAddress("buyer") };
}

/** Attributes come back tagged with their type; the UI only wants the values. */
function flatten(attributes: Record<string, { value: unknown }>) {
  return Object.fromEntries(
    Object.entries(attributes).map(([name, cell]) => [name, String(cell.value)]),
  );
}
