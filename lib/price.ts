import { formatEther, parseEther } from "viem";

/**
 * Prices are entered and shown in AVAX, not wei.
 *
 * A seller pricing a dataset should not have to count eighteen zeros, and a buyer
 * should not have to read them. Wei exists at the contract boundary and nowhere else in
 * the UI.
 */

/** u64 is the Arkiv attribute type for price, so this is the real ceiling. */
export const MAX_PRICE_PER_DAY_WEI = 18_446_744_073_709_551_615n;

export function avaxToWei(avax: string): bigint {
  const parsed = parseEther(avax.trim() === "" ? "0" : avax.trim());
  if (parsed > MAX_PRICE_PER_DAY_WEI) {
    throw new Error(
      `Maximum price is ${formatEther(MAX_PRICE_PER_DAY_WEI)} AVAX/day — the Arkiv ` +
        `attribute is a u64.`,
    );
  }
  return parsed;
}

export function weiToAvax(wei: bigint | string): string {
  return formatEther(typeof wei === "string" ? BigInt(wei) : wei);
}

/** "0.0012 AVAX", trimmed to something a human reads at a glance. */
export function formatAvax(wei: bigint | string, maxDecimals = 6): string {
  const value = Number(weiToAvax(wei));
  if (value === 0) return "free";
  if (value < 10 ** -maxDecimals) return `<0.000001 AVAX`;
  return `${trimZeros(value.toFixed(maxDecimals))} AVAX`;
}

/** What a term actually costs, pro-rated from the daily price the same way the contract does. */
export function proRatedWei(pricePerDayWei: bigint, seconds: number): bigint {
  return (pricePerDayWei * BigInt(seconds)) / 86_400n;
}

function trimZeros(value: string): string {
  return value.replace(/\.?0+$/, "");
}
