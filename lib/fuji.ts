import { createWalletClient, http, parseAbi, publicActions } from "viem";
import { avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Settlement on Avalanche Fuji.
 *
 * The contract holds the money and the rule; Arkiv holds the access. Payment happens
 * before a grant is written, so a licence cannot exist without the transaction that
 * paid for it. When the contract is not configured this returns `settled: false` with
 * an explicit marker rather than a plausible-looking hash — a demo that silently mints
 * unpaid licences is worse than one that admits settlement is off.
 */

export const LICENCE_ABI = parseAbi([
  "function registerTerms(string listingId, uint256 pricePerDayWei, uint64 minSeconds, uint64 maxSeconds, bytes32 schemaCommitment)",
  "function quote(string listingId, uint64 termSeconds) view returns (uint256)",
  "function purchase(string listingId, uint64 termSeconds) payable returns (uint256)",
  "function owed(address account) view returns (uint256)",
  "function withdraw()",
  "function denied(string listingId, address account) view returns (bool)",
  "function setEligibility(string listingId, address account, bool deny)",
  "event LicencePurchased(uint256 indexed licenceId, string indexed listingId, address indexed buyer, address dataOwner, uint64 termSeconds, uint256 paid)",
]);

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
