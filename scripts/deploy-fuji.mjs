/**
 * Compiles DataLicence.sol and deploys it to Avalanche Fuji. `npm run deploy:fuji`.
 *
 * Writes the ABI to contracts/DataLicence.abi.json and prints the address to put in
 * .env.local. Uses solc directly rather than Foundry so there is no extra toolchain to
 * install at 4am.
 */
import solc from "solc";
import fs from "node:fs";
import { createWalletClient, http, publicActions, formatEther } from "viem";
import { avalancheFuji } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

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

const deployerKey = env.FUJI_DEPLOYER_PRIVATE_KEY || env.FUJI_BUYER_PRIVATE_KEY;
if (!deployerKey) {
  console.error("Set FUJI_DEPLOYER_PRIVATE_KEY (or FUJI_BUYER_PRIVATE_KEY) in .env.local.");
  process.exit(1);
}

// ---- compile --------------------------------------------------------------
const source = fs.readFileSync(new URL("contracts/DataLicence.sol", root), "utf8");

const output = JSON.parse(
  solc.compile(
    JSON.stringify({
      language: "Solidity",
      sources: { "DataLicence.sol": { content: source } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
      },
    }),
  ),
);

const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}
(output.errors ?? [])
  .filter((e) => e.severity === "warning")
  .forEach((e) => console.log("warning:", e.formattedMessage.trim()));

const artifact = output.contracts["DataLicence.sol"].DataLicence;
const abi = artifact.abi;
const bytecode = `0x${artifact.evm.bytecode.object}`;

fs.writeFileSync(new URL("contracts/DataLicence.abi.json", root), JSON.stringify(abi, null, 2));
console.log(`compiled — ${(bytecode.length / 2 - 1).toLocaleString()} bytes of bytecode`);

// ---- deploy ---------------------------------------------------------------
const account = privateKeyToAccount(deployerKey);
const client = createWalletClient({
  chain: avalancheFuji,
  transport: http(env.NEXT_PUBLIC_FUJI_RPC),
  account,
}).extend(publicActions);

const balance = await client.getBalance({ address: account.address });
console.log(`deployer ${account.address} — ${formatEther(balance)} AVAX`);
if (balance === 0n) {
  console.error("\nNo test AVAX. Fund it at https://core.app/tools/testnet-faucet/ and retry.");
  process.exit(1);
}

const hash = await client.deployContract({ abi, bytecode });
console.log(`deploy tx ${hash}`);

const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") {
  console.error("Deployment reverted.");
  process.exit(1);
}

console.log(`\nDeployed at ${receipt.contractAddress}`);
console.log(`Explorer     https://testnet.snowtrace.io/address/${receipt.contractAddress}`);
console.log(`Gas used     ${receipt.gasUsed}`);
console.log(`\nAdd to .env.local:`);
console.log(`NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS=${receipt.contractAddress}`);
