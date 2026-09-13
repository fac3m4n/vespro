import { createPublicClient, createWalletClient, http, parseEventLogs, publicActions } from "viem";
import { avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { LICENCE_ABI } from "@/lib/fujiAbi";

/**
 * Settlement on Avalanche Fuji.
 *
 * The contract holds the money and the rule; Arkiv holds the access. Payment happens
 * before a grant is written, so a licence cannot exist without the transaction that
 * paid for it. When the contract is not configured this returns `settled: false` with
 * an explicit marker rather than a plausible-looking hash — a demo that silently mints
 * unpaid licences is worse than one that admits settlement is off.
 */

export { LICENCE_ABI } from "@/lib/fujiAbi";

const CONTRACT = process.env.NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS as
  | `0x${string}`
  | undefined;
const RPC = process.env.NEXT_PUBLIC_FUJI_RPC ?? "https://api.avax-test.network/ext/bc/C/rpc";

export type Settlement = {
  settled: boolean;
  txHash: string;
  chain: string;
  explorerUrl: string | null;
  paidWei?: string;
  licenceId?: string;
  note?: string;
};

function client(role: "owner" | "buyer") {
  const key =
    role === "owner"
      ? process.env.FUJI_DEPLOYER_PRIVATE_KEY
      : process.env.FUJI_BUYER_PRIVATE_KEY;
  if (!key) throw new Error(`Missing Fuji ${role} key.`);

  return createWalletClient({
    chain: avalancheFuji,
    transport: http(RPC),
    account: privateKeyToAccount(key as `0x${string}`),
  }).extend(publicActions);
}

export function fujiConfigured(): boolean {
  return Boolean(
    CONTRACT && process.env.FUJI_BUYER_PRIVATE_KEY && process.env.FUJI_DEPLOYER_PRIVATE_KEY,
  );
}

export function fujiContractAddress(): string | null {
  return CONTRACT ?? null;
}

/**
 * Who the contract will actually pay for this listing.
 *
 * When a seller registers terms from their own wallet the client tells us the payout
 * address, and a client is not a source of truth about who gets paid. This reads it back
 * from the chain so the address recorded in Arkiv is the one the contract will credit.
 * Returns null when no terms exist, which is how `termsFor` reverts.
 */
export async function readTermsOwner(listing_id: string): Promise<`0x${string}` | null> {
  if (!CONTRACT) return null;

  const reader = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });

  try {
    const terms = await reader.readContract({
      address: CONTRACT,
      abi: LICENCE_ABI,
      functionName: "termsFor",
      args: [listing_id],
    });
    return terms.dataOwner;
  } catch {
    return null;
  }
}

/**
 * The asset rule, onchain. Called when a dataset is listed, so the terms a buyer pays
 * under are published before anyone can pay them.
 */
export async function registerTermsOnFuji(input: {
  listing_id: string;
  price_per_day_wei: bigint;
  minSeconds: number;
  maxSeconds: number;
  schemaCommitment: `0x${string}`;
}): Promise<{ registered: boolean; txHash: string | null; note?: string }> {
  if (!fujiConfigured()) {
    return { registered: false, txHash: null, note: "Fuji not configured" };
  }

  const owner = client("owner");
  const txHash = await owner.writeContract({
    address: CONTRACT!,
    abi: LICENCE_ABI,
    functionName: "registerTerms",
    args: [
      input.listing_id,
      input.price_per_day_wei,
      BigInt(input.minSeconds),
      BigInt(input.maxSeconds),
      input.schemaCommitment,
    ],
  });

  await owner.waitForTransactionReceipt({ hash: txHash });
  return { registered: true, txHash };
}

/**
 * Confirms a client-submitted purchase actually happened, and happened here.
 *
 * A buyer paying from their own wallet means the server never sees the transaction being
 * made, only a hash afterwards. Three things therefore get checked against the chain:
 * the receipt succeeded, it was sent to our contract, and it emitted LicencePurchased.
 * Without the last two, any successful transaction on Fuji — a plain transfer — would buy
 * a licence for free.
 */
export async function verifyPurchaseTx(
  txHash: `0x${string}`,
): Promise<{ ok: true; settlement: Settlement } | { ok: false; reason: string }> {
  if (!CONTRACT) return { ok: false, reason: "settlement contract is not configured" };

  const reader = createPublicClient({ chain: avalancheFuji, transport: http(RPC) });

  let receipt;
  try {
    receipt = await reader.getTransactionReceipt({ hash: txHash });
  } catch {
    return { ok: false, reason: "transaction not found on Fuji" };
  }

  if (receipt.status !== "success") return { ok: false, reason: "transaction reverted" };
  if (receipt.to?.toLowerCase() !== CONTRACT.toLowerCase()) {
    return { ok: false, reason: "transaction was not sent to the licence contract" };
  }

  const purchases = parseEventLogs({
    abi: LICENCE_ABI,
    eventName: "LicencePurchased",
    logs: receipt.logs,
  });

  const purchase = purchases[0];
  if (!purchase) return { ok: false, reason: "no LicencePurchased event in that transaction" };

  return {
    ok: true,
    settlement: {
      settled: true,
      txHash,
      chain: "avalanche-fuji",
      explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}`,
      paidWei: purchase.args.paid.toString(),
      licenceId: purchase.args.licenceId.toString(),
      note: "paid from the buyer's own wallet",
    },
  };
}

export async function settleOnFuji(input: {
  listing_id: string;
  seconds: number;
}): Promise<Settlement> {
  if (!fujiConfigured()) {
    return {
      settled: false,
      txHash: "unsettled:fuji-not-configured",
      chain: "none",
      explorerUrl: null,
      note: "Set NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS and the Fuji keys to settle.",
    };
  }

  const buyer = client("buyer");

  // Asked, not recomputed. The contract rounds when it pro-rates a daily price, and a
  // client that reimplements that arithmetic eventually disagrees with it by one wei
  // and reverts on WrongPayment.
  const value = await buyer.readContract({
    address: CONTRACT!,
    abi: LICENCE_ABI,
    functionName: "quote",
    args: [input.listing_id, BigInt(input.seconds)],
  });

  const txHash = await buyer.writeContract({
    address: CONTRACT!,
    abi: LICENCE_ABI,
    functionName: "purchase",
    args: [input.listing_id, BigInt(input.seconds)],
    value,
  });

  const receipt = await buyer.waitForTransactionReceipt({ hash: txHash });
  if (receipt.status !== "success") {
    throw new Error(`Fuji settlement reverted: ${txHash}`);
  }

  return {
    settled: true,
    txHash,
    chain: "avalanche-fuji",
    explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}`,
    paidWei: value.toString(),
  };
}
