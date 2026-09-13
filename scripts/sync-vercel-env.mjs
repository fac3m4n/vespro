/**
 * Copies .env.local into the Vercel project's stored environment variables.
 * `npm run env:sync`
 *
 * Needed because `vercel deploy --env` only applies to that one deployment. A build
 * triggered by a git push reads the project's stored variables instead, and with none set
 * the app builds fine and then fails at runtime — the websocket client throws without
 * NEXT_PUBLIC_ARKIV_RPC_WS, and every write route throws without its signing key.
 *
 * Values are piped to the CLI on stdin, never passed as arguments, so nothing secret is
 * visible in the process list or echoed to the terminal.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [
      line.slice(0, line.indexOf("=")).trim(),
      line.slice(line.indexOf("=") + 1).trim(),
    ])
    .filter(([, value]) => value !== ""),
);

const TARGETS = ["production", "preview", "development"];

function run(args, stdin) {
  return new Promise((resolve) => {
    const child = spawn("npx", ["--yes", "vercel@latest", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    if (stdin !== undefined) child.stdin.end(stdin);
    child.on("exit", (code) => resolve({ code, out }));
  });
}

for (const [key, value] of Object.entries(env)) {
  for (const target of TARGETS) {
    // Remove first so re-running is idempotent rather than erroring on "already exists".
    await run(["env", "rm", key, target, "--yes"]);
    const { code, out } = await run(["env", "add", key, target], value);
    const ok = code === 0;
    console.log(`${ok ? "ok  " : "FAIL"} ${key} → ${target}${ok ? "" : `\n     ${out.trim()}`}`);
  }
}

console.log(`\n${Object.keys(env).length} variables synced to production, preview and development.`);
console.log("A new build is required for NEXT_PUBLIC_* values — they are inlined at build time.");
