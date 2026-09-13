/**
 * Deploys to Vercel, passing .env.local through without ever printing it.
 * `npm run deploy:web`
 *
 * NEXT_PUBLIC_* values are inlined at build time so they go to --build-env as well as
 * --env; the signing keys are runtime-only and go to --env alone. Secrets are passed as
 * argv to the child process and never echoed, so nothing lands in a terminal log.
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

const args = ["--yes", "vercel@latest", "deploy", "--prod"];
if (process.argv.includes("--temporary")) args.push("--temporary");

for (const [key, value] of Object.entries(env)) {
  args.push("--env", `${key}=${value}`);
  if (key.startsWith("NEXT_PUBLIC_")) args.push("--build-env", `${key}=${value}`);
}

const publicKeys = Object.keys(env).filter((k) => k.startsWith("NEXT_PUBLIC_"));
const secretKeys = Object.keys(env).filter((k) => !k.startsWith("NEXT_PUBLIC_"));
console.log(`Passing ${publicKeys.length} public and ${secretKeys.length} secret env vars.`);
console.log(`  public: ${publicKeys.join(", ")}`);
console.log(`  secret: ${secretKeys.map((k) => `${k}=<hidden>`).join(", ")}\n`);

const child = spawn("npx", args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
