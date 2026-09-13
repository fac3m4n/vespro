/**
 * Proves the single-wallet demo works onchain: one address registers terms, buys its own
 * licence, and withdraws the proceeds. `npm run e2e:wallet`
 *
 * Worth checking rather than assuming — a self-purchase guard in the contract would break
 * the whole one-wallet demo flow, and the failure would only appear live.
 */
import fs from "node:fs";
import { createWalletClient, formatEther, http, publicActions } from "viem";
import { avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { LICENCE_ABI } from "../lib/fujiAbi.ts";

const root = new URL("..", import.meta.url);
const env = Object.fromEntries(
  fs
    .readFileSync(new URL(".env.local", root), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")).trim(),
      line.slice(line.indexOf("=") + 1).trim(),
    ]),
);

const CONTRACT = env.NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS;
const key = env.FUJI_DEPLOYER_PRIVATE_KEY;
if (!CONTRACT || !key) {
  console.error("Need NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS and FUJI_DEPLOYER_PRIVATE_KEY.");
  process.exit(1);
}

const account = privateKeyToAccount(key);
const client = createWalletClient({
  account,
  chain: avalancheFuji,
  transport: http(env.NEXT_PUBLIC_FUJI_RPC),
}).extend(publicActions);

const listingId = `one-wallet-${Date.now().toString(36)}`;
const pricePerDay = 10_000_000_000_000_000n; // 0.01 AVAX/day
const term = 60n;

console.log(`address    ${account.address}`);
console.log(`balance    ${formatEther(await client.getBalance({ address: account.address }))} AVAX`);
console.log(`listing    ${listingId}\n`);

async function send(label, request) {
  const hash = await client.writeContract(request);
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`${label.padEnd(16)} ${receipt.status} ${hash}`);
  if (receipt.status !== "success") process.exit(1);
  return receipt;
}

await send("registerTerms", {
  address: CONTRACT,
  abi: LICENCE_ABI,
  functionName: "registerTerms",
  args: [listingId, pricePerDay, 60n, 600n, `0x${"11".repeat(32)}`],
});

const terms = await client.readContract({
  address: CONTRACT,
  abi: LICENCE_ABI,
  functionName: "termsFor",
  args: [listingId],
});
console.log(`dataOwner        ${terms.dataOwner}`);
console.log(`is us            ${terms.dataOwner.toLowerCase() === account.address.toLowerCase()}`);

const quote = await client.readContract({
  address: CONTRACT,
  abi: LICENCE_ABI,
  functionName: "quote",
  args: [listingId, term],
});
console.log(`quote 60s        ${quote} wei\n`);

// The point of the test: the seller is also the buyer.
await send("purchase(self)", {
  address: CONTRACT,
  abi: LICENCE_ABI,
  functionName: "purchase",
  args: [listingId, term],
  value: quote,
});

const owed = await client.readContract({
  address: CONTRACT,
  abi: LICENCE_ABI,
  functionName: "owed",
  args: [account.address],
});
console.log(`owed             ${owed} wei`);

if (owed < quote) {
  console.error("\nThe purchase did not credit the data owner.");
  process.exit(1);
}

await send("withdraw", {
  address: CONTRACT,
  abi: LICENCE_ABI,
  functionName: "withdraw",
  args: [],
});

const after = await client.readContract({
  address: CONTRACT,
  abi: LICENCE_ABI,
  functionName: "owed",
  args: [account.address],
});

console.log(`owed after       ${after} wei`);
console.log(
  after === 0n
    ? "\nOne wallet can sell, buy its own licence, and withdraw. Demo flow is sound."
    : "\nWithdraw did not clear the balance.",
);
process.exit(after === 0n ? 0 : 1);
