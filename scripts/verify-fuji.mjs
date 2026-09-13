/**
 * Verifies DataLicence on Snowtrace (Routescan) so the explorer shows function names
 * instead of a bare selector. `npm run verify:fuji`
 *
 * Submits the exact standard-JSON input the deploy used, because Routescan recompiles
 * and compares bytecode — any drift in settings or source and it rejects the submission.
 * Checks the local build against the deployed runtime code first, so a mismatch is
 * reported here rather than as an opaque explorer error.
 */
import solc from "solc";
import fs from "node:fs";
import { createPublicClient, http } from "viem";
import { avalancheFuji } from "viem/chains";

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

const address = env.NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS;
if (!address) {
  console.error("NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS is not set in .env.local.");
  process.exit(1);
}

// Must match scripts/deploy-fuji.mjs exactly.
const standardJson = {
  language: "Solidity",
  sources: {
    "DataLicence.sol": {
      content: fs.readFileSync(new URL("contracts/DataLicence.sol", root), "utf8"),
    },
  },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(standardJson)));
const errors = (output.errors ?? []).filter((e) => e.severity === "error");
if (errors.length) {
  errors.forEach((e) => console.error(e.formattedMessage));
  process.exit(1);
}

const artifact = output.contracts["DataLicence.sol"].DataLicence;
const localRuntime = `0x${artifact.evm.deployedBytecode.object}`;

const client = createPublicClient({
  chain: avalancheFuji,
  transport: http(env.NEXT_PUBLIC_FUJI_RPC),
});

const onchain = await client.getCode({ address });
if (!onchain || onchain === "0x") {
  console.error(`No contract deployed at ${address}.`);
  process.exit(1);
}

/**
 * The trailing CBOR metadata hash covers the source path and compiler build, so it
 * legitimately differs even for identical logic. Comparing the code before it is enough
 * to catch real drift.
 */
const strip = (code) => code.slice(0, Math.max(0, code.length - 106));
const matches = strip(onchain) === strip(localRuntime);

console.log(`contract  ${address}`);
console.log(`solc      ${solc.version()}`);
console.log(`onchain   ${onchain.length / 2 - 1} bytes`);
console.log(`local     ${localRuntime.length / 2 - 1} bytes`);
console.log(`bytecode  ${matches ? "matches" : "DOES NOT MATCH"}`);

if (!matches) {
  console.error(
    "\nThe local source no longer compiles to the deployed code. Redeploy with\n" +
      "`npm run deploy:fuji` before verifying, or verification will be rejected.",
  );
  process.exit(1);
}

// Routescan is Snowtrace's backend and accepts the Etherscan v1 verify API without a key.
const API = "https://api.routescan.io/v2/network/testnet/evm/43113/etherscan/api";

const body = new URLSearchParams({
  module: "contract",
  action: "verifysourcecode",
  contractaddress: address,
  sourceCode: JSON.stringify(standardJson),
  codeformat: "solidity-standard-json-input",
  contractname: "DataLicence.sol:DataLicence",
  compilerversion: `v${solc.version().replace(".Emscripten.clang", "")}`,
  optimizationUsed: "1",
  runs: "200",
});

const submit = await fetch(API, {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
}).then((r) => r.json());

console.log(`\nsubmit    ${JSON.stringify(submit)}`);

if (submit.status !== "1") {
  if (String(submit.result ?? "").toLowerCase().includes("already verified")) {
    console.log("\nAlready verified.");
    process.exit(0);
  }
  console.error("\nSubmission rejected.");
  process.exit(1);
}

// Poll until the recompile finishes.
const guid = submit.result;
for (let attempt = 1; attempt <= 30; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 4000));
  const check = await fetch(
    `${API}?module=contract&action=checkverifystatus&guid=${guid}`,
  ).then((r) => r.json());

  const message = String(check.result ?? "");
  console.log(`  [${attempt}] ${message}`);

  if (message.toLowerCase().includes("pending")) continue;

  if (check.status === "1" || message.toLowerCase().includes("already verified")) {
    console.log(`\nVerified — https://testnet.snowtrace.io/address/${address}#code`);
    process.exit(0);
  }

  console.error("\nVerification failed.");
  process.exit(1);
}

console.error("\nTimed out waiting for verification.");
process.exit(1);
