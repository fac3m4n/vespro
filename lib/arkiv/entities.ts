import { ExpirationTime, jsonToPayload } from "@arkiv-network/sdk/utils";
import { arkivReadClient, arkivWriteClient, roleAddress } from "./client";
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
 */
export async function createGrant(
  listing_id: string,
  owner: `0x${string}`,
  option: LicenceOption,
  settlement_tx: string,
  jobSpec: GrantPayload["jobSpec"],
  /**
   * The address the licence is for. Defaults to the shared demo buyer, but when a real
   * wallet paid it must be that wallet — the access check queries on this attribute, so
   * getting it wrong would grant the licence to someone who never paid.
   */
  buyerAddress?: `0x${string}`,
): Promise<CreatedEntity & { purchasedSeconds: number; buyer: `0x${string}` }> {
  const client = arkivWriteClient("buyer");
  const buyer = buyerAddress ?? client.account.address;
  const purchasedSeconds = LICENCE_SECONDS[option];

  const payload: GrantPayload = { listing_id, purchasedSeconds, jobSpec };

  const { entityKey, txHash } = await client.createEntity({
    payload: jsonToPayload(payload),
    contentType: "application/json",
    attributes: grantAttributes({ listing_id, buyer, owner, settlement_tx }),
    expires: ExpirationTime.fromSeconds(purchasedSeconds),
  });

  return { entityKey, txHash, purchasedSeconds, buyer };
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
 */
export async function publishTrainingResult(
  entityKey: `0x${string}`,
  result: { weights: number[]; bias: number; loss: number[]; rowsUsed: number },
) {
  const client = arkivWriteClient("owner");
  return client.patchEntity({
    entityKey,
    payload: jsonToPayload({ trained: result, completedAt: Date.now() }),
  });
}

export async function fetchListings(filters: BrowseFilters) {
  const client = arkivReadClient();
  const result = await client
    .select({ key: true, owner: true, attributes: true, payload: true, expiresAt: true })
    .where(browseListings(filters))
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
 */
export async function hasLiveGrant(
  listing_id: string,
  buyer: `0x${string}`,
): Promise<boolean> {
  const client = arkivReadClient();
  const result = await client
    .select({ key: true })
    .where(liveGrant(listing_id, buyer))
    .limit(1)
    .fetch();
  return result.entities.length > 0;
}

export async function fetchOwnerGrants(owner: `0x${string}`) {
  const client = arkivReadClient();
  const result = await client
    .select({ key: true, attributes: true, payload: true, expiresAt: true })
    .where(grantsForOwner(owner))
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
 */
export async function fetchEntity(entityKey: `0x${string}`) {
  const client = arkivReadClient();
  try {
    const entity = await client.getEntity(entityKey);
    return {
      key: entity.key,
      owner: entity.owner,
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
