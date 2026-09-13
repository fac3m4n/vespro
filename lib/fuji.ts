import { createWalletClient, http, parseAbi, publicActions } from "viem";
import { avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

/**
 * Settlement on Avalanche Fuji.
 *
 * Payment is what makes a licence exist, so it happens before the grant is written.
 * If the contract is not configured this returns `settled: false` with an explicit
 * marker instead of a plausible-looking hash — a demo that silently mints licences
 * nobody paid for is worse than one that admits settlement is off.
 */

export const LICENCE_ABI = parseAbi([
  "function purchase(string listing_id, address dataOwner, uint64 seconds_) payable returns (uint256)",
  "event LicencePurchased(uint256 indexed id, string listing_id, address indexed buyer, address indexed dataOwner, uint64 seconds_, uint256 paid)",
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
  note?: string;
};

export function fujiConfigured(): boolean {
  return Boolean(CONTRACT && process.env.FUJI_BUYER_PRIVATE_KEY);
}

export async function settleOnFuji(input: {
  listing_id: string;
  owner: `0x${string}`;
  seconds: number;
  price_per_day_wei: bigint;
}): Promise<Settlement> {
  if (!fujiConfigured()) {
    return {
      settled: false,
      txHash: "unsettled:fuji-not-configured",
      chain: "none",
      explorerUrl: null,
      note: "Set NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS and FUJI_BUYER_PRIVATE_KEY to settle on Fuji.",
    };
  }

  const client = createWalletClient({
    chain: avalancheFuji,
    transport: http(RPC),
    account: privateKeyToAccount(process.env.FUJI_BUYER_PRIVATE_KEY as `0x${string}`),
  }).extend(publicActions);

  // Pro-rated from the per-day price, so a 60-second licence costs 60 seconds of it.
  const value = (input.price_per_day_wei * BigInt(input.seconds)) / 86_400n;

  const txHash = await client.writeContract({
    address: CONTRACT!,
    abi: LICENCE_ABI,
    functionName: "purchase",
    args: [input.listing_id, input.owner, BigInt(input.seconds)],
    value,
  });

  await client.waitForTransactionReceipt({ hash: txHash });

  return {
    settled: true,
    txHash,
    chain: "avalanche-fuji",
    explorerUrl: `https://testnet.snowtrace.io/tx/${txHash}`,
  };
}
