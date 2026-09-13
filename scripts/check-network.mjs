/**
 * Preflight. Run with `npm run check`.
 *
 * Answers the three questions that otherwise turn into confusing UI failures: is the
 * RPC up, are the burner wallets funded, and is the websocket transport actually a
 * websocket. The last one matters most — an http transport still works, so nothing
 * else in the app would tell you it had quietly become a poll.
 */
import { createPublicClient } from "@arkiv-network/sdk";
import { tiramisu } from "@arkiv-network/sdk/chains";
import { http, webSocket } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")).trim(),
      line.slice(line.indexOf("=") + 1).trim(),
    ]),
);

let failures = 0;
const fail = (message) => {
  failures++;
  console.log(`  FAIL  ${message}`);
};
const pass = (message) => console.log(`  ok    ${message}`);

console.log("\nArkiv Tiramisu over http");
const readClient = createPublicClient({
  chain: tiramisu,
  transport: http(env.NEXT_PUBLIC_ARKIV_RPC_HTTP),
});

try {
  const chainId = await readClient.getChainId();
  const block = await readClient.getBlockNumber();
  chainId === 7738577
    ? pass(`chain ${chainId}, block ${block}`)
    : fail(`unexpected chain id ${chainId}, expected 7738577`);
} catch (error) {
  fail(`http RPC unreachable: ${error.shortMessage ?? error.message}`);
}

console.log("\nBurner wallets");
for (const key of ["ARKIV_OWNER_PRIVATE_KEY", "ARKIV_BUYER_PRIVATE_KEY"]) {
  if (!env[key]) {
    fail(`${key} is not set`);
    continue;
  }
  const account = privateKeyToAccount(env[key]);
  try {
    const balance = await readClient.getBalance({ address: account.address });
    balance > 0n
      ? pass(`${key.split("_")[1].toLowerCase()} ${account.address} — ${balance} wei`)
      : fail(
          `${key.split("_")[1].toLowerCase()} ${account.address} has no GLM. ` +
            `Fund it at https://hub.arkiv.network/faucet`,
        );
  } catch (error) {
    fail(`balance lookup failed: ${error.shortMessage ?? error.message}`);
  }
}

console.log("\nWebsocket transport (Mission 03)");
try {
  const wsClient = createPublicClient({
    chain: tiramisu,
    transport: webSocket(env.NEXT_PUBLIC_ARKIV_RPC_WS),
  });
  wsClient.transport.type === "webSocket"
    ? pass(`transport.type === "webSocket"`)
    : fail(`transport.type is "${wsClient.transport.type}" — this would poll, not subscribe`);
  pass(`chain ${await wsClient.getChainId()} over the socket`);
} catch (error) {
  fail(`websocket unreachable: ${error.shortMessage ?? error.message}`);
}

console.log(
  failures === 0
    ? "\nAll checks passed.\n"
    : `\n${failures} check(s) failed — fix these before demoing.\n`,
);
process.exit(failures === 0 ? 0 : 1);
