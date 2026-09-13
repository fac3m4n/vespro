"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  formatEther,
  http,
  type EIP1193Provider,
  type WalletClient,
} from "viem";
import { avalancheFuji } from "viem/chains";
import { LICENCE_ABI } from "@/lib/fujiAbi";

/**
 * The user's own wallet, over the injected EIP-1193 provider.
 *
 * This exists because of a real hole: the contract sets `dataOwner = msg.sender` in
 * registerTerms, so when the server signed that call with a shared burner key every
 * listing's payout address was ours and a seller could never withdraw. Signing from the
 * seller's own wallet is what makes the money actually theirs.
 *
 * Deliberately no wagmi. One provider, one chain, two calls — a connector framework
 * would be more code than the thing it wraps.
 */

const FUJI_RPC = process.env.NEXT_PUBLIC_FUJI_RPC ?? "https://api.avax-test.network/ext/bc/C/rpc";
const CONTRACT = process.env.NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS as `0x${string}` | undefined;

export type WalletState = {
  address: `0x${string}` | null;
  balanceWei: bigint | null;
  chainId: number | null;
  /** True only when connected *and* on Fuji, which is the only state that can transact. */
  ready: boolean;
  available: boolean;
  /** This browser has connected before, so a silent restore is expected to find it. */
  optedIn: boolean;
  error: string | null;
};

const EMPTY: WalletState = {
  address: null,
  balanceWei: null,
  chainId: null,
  ready: false,
  available: false,
  optedIn: false,
  error: null,
};

let state: WalletState = EMPTY;
const listeners = new Set<(state: WalletState) => void>();

function publish(next: Partial<WalletState>) {
  state = { ...state, ...next };
  state.ready = Boolean(state.address) && state.chainId === avalancheFuji.id;
  listeners.forEach((fn) => fn(state));
}

export function onWallet(fn: (state: WalletState) => void): () => void {
  listeners.add(fn);
  fn({ ...state, available: hasProvider() });
  return () => listeners.delete(fn);
}

export function walletState(): WalletState {
  return state;
}

function hasProvider(): boolean {
  return typeof window !== "undefined" && Boolean((window as { ethereum?: unknown }).ethereum);
}

/**
 * Waits briefly for the wallet extension to inject itself.
 *
 * Extensions inject `window.ethereum` asynchronously, so a check that runs at mount can
 * lose the race and conclude no wallet exists — after which the UI stays stuck on the
 * "demo wallet" badge for the whole session even though one is installed.
 */
function awaitProvider(timeoutMs = 3000): Promise<boolean> {
  if (hasProvider()) return Promise.resolve(true);
  if (typeof window === "undefined") return Promise.resolve(false);

  return new Promise((resolve) => {
    let settled = false;

    const finish = (found: boolean) => {
      if (settled) return;
      settled = true;
      clearInterval(poll);
      clearTimeout(cap);
      window.removeEventListener("ethereum#initialized", onReady);
      resolve(found);
    };

    const onReady = () => finish(true);

    // Both, because which one fires depends on the extension.
    window.addEventListener("ethereum#initialized", onReady, { once: true });
    const poll = setInterval(() => hasProvider() && finish(true), 100);
    const cap = setTimeout(() => finish(hasProvider()), timeoutMs);
  });
}

/**
 * Whether this browser has ever opted in.
 *
 * `eth_accounts` is enough to restore an authorised wallet, but this flag lets the UI
 * distinguish "never connected" from "connected before, now locked" — the second wants a
 * reconnect prompt, the first should be left alone.
 */
const OPTED_IN_KEY = "vespro:wallet-opted-in";

function rememberOptIn() {
  try {
    localStorage.setItem(OPTED_IN_KEY, "1");
  } catch {
    // Private-mode storage failures are not worth breaking a connection over.
  }
}

function hasOptedIn(): boolean {
  try {
    return localStorage.getItem(OPTED_IN_KEY) === "1";
  } catch {
    return false;
  }
}

export function forgetWallet() {
  try {
    localStorage.removeItem(OPTED_IN_KEY);
  } catch {
    // ignored
  }
  publish({ address: null, balanceWei: null, error: null });
}

function provider(): EIP1193Provider {
  const injected = (window as unknown as { ethereum?: EIP1193Provider }).ethereum;
  if (!injected) {
    throw new Error("No wallet found. Install Core or MetaMask, then reload.");
  }
  return injected;
}

const publicClient = createPublicClient({ chain: avalancheFuji, transport: http(FUJI_RPC) });

/** Reads the balance of whatever is connected, so the UI never shows a stale number. */
async function refreshBalance(address: `0x${string}`) {
  try {
    publish({ balanceWei: await publicClient.getBalance({ address }) });
  } catch {
    publish({ balanceWei: null });
  }
}

/**
 * Attaches to an already-authorised wallet without prompting.
 *
 * `eth_accounts` rather than `eth_requestAccounts`: opening a wallet popup because
 * someone loaded the page is hostile, and on a shared demo machine it is also confusing.
 */
export async function restoreWallet(): Promise<void> {
  if (!(await awaitProvider())) {
    publish({ available: false });
    return;
  }
  publish({ available: true, optedIn: hasOptedIn() });

  try {
    const injected = provider();
    const accounts = (await injected.request({ method: "eth_accounts" })) as `0x${string}`[];
    const chainId = Number(await injected.request({ method: "eth_chainId" }));

    subscribe(injected);

    if (accounts.length === 0) {
      publish({ address: null, chainId, balanceWei: null });
      return;
    }
    publish({ address: accounts[0], chainId });
    await refreshBalance(accounts[0]);
  } catch (error) {
    publish({ error: error instanceof Error ? error.message : "wallet unavailable" });
  }
}

let subscribed = false;
function subscribe(injected: EIP1193Provider) {
  if (subscribed) return;
  subscribed = true;

  injected.on?.("accountsChanged", (accounts) => {
    const next = (accounts as `0x${string}`[])[0] ?? null;
    publish({ address: next, balanceWei: null, error: null });
    if (next) void refreshBalance(next);
    // Revoking the site in the wallet should clear the opt-in too, otherwise the UI keeps
    // offering to reconnect something the user deliberately disconnected.
    else forgetWallet();
  });

  /**
   * Update state; do not reload.
   *
   * This used to call window.location.reload(). Some wallets emit chainChanged as soon as
   * a listener is registered, which turned every page load into a reload — and each reload
   * re-ran the connect path, so it looked like the wallet was asking to connect on every
   * refresh. Nothing here needs a reload: chainId is the only thing that changed, `ready`
   * is derived from it, and the balance is refetched below.
   */
  injected.on?.("chainChanged", (chainId) => {
    publish({ chainId: Number(chainId) });
    if (state.address) void refreshBalance(state.address);
  });
}

export async function connectWallet(): Promise<void> {
  const injected = provider();
  publish({ error: null });

  const accounts = (await injected.request({
    method: "eth_requestAccounts",
  })) as `0x${string}`[];

  subscribe(injected);
  rememberOptIn();
  publish({ address: accounts[0] ?? null, optedIn: true });

  await switchToFuji();
  if (accounts[0]) await refreshBalance(accounts[0]);
}

/** Adds Fuji if the wallet has never seen it, which is the common case for MetaMask. */
export async function switchToFuji(): Promise<void> {
  const injected = provider();
  const hexId = `0x${avalancheFuji.id.toString(16)}`;

  try {
    await injected.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexId }],
    });
  } catch (error) {
    // 4902 = unrecognised chain. Anything else is a genuine failure or a user rejection.
    const code = (error as { code?: number }).code;
    if (code !== 4902) throw error;

    await injected.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: hexId,
          chainName: "Avalanche Fuji C-Chain",
          nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
          rpcUrls: [FUJI_RPC],
          blockExplorerUrls: ["https://testnet.snowtrace.io"],
        },
      ],
    });
  }

  publish({ chainId: Number(await injected.request({ method: "eth_chainId" })) });
}

function walletClient(address: `0x${string}`): WalletClient {
  return createWalletClient({
    account: address,
    chain: avalancheFuji,
    transport: custom(provider()),
  });
}

function requireReady(): `0x${string}` {
  if (!state.address) throw new Error("Connect a wallet first.");
  if (state.chainId !== avalancheFuji.id) throw new Error("Switch to Avalanche Fuji first.");
  if (!CONTRACT) throw new Error("NEXT_PUBLIC_LICENCE_CONTRACT_ADDRESS is not set.");
  return state.address;
}

/**
 * Publishes the asset rule from the seller's own wallet, which is the whole point: the
 * contract records msg.sender as dataOwner, so this is what makes the seller the payee.
 */
export async function registerTermsFromWallet(input: {
  listing_id: string;
  price_per_day_wei: bigint;
  minSeconds: number;
  maxSeconds: number;
  schemaCommitment: `0x${string}`;
}): Promise<string> {
  const address = requireReady();

  const hash = await walletClient(address).writeContract({
    address: CONTRACT!,
    abi: LICENCE_ABI,
    chain: avalancheFuji,
    account: address,
    functionName: "registerTerms",
    args: [
      input.listing_id,
      input.price_per_day_wei,
      BigInt(input.minSeconds),
      BigInt(input.maxSeconds),
      input.schemaCommitment,
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`registerTerms reverted: ${hash}`);

  await refreshBalance(address);
  return hash;
}

/** Buys a licence with the buyer's own money, so the payment is genuinely theirs. */
export async function purchaseFromWallet(input: {
  listing_id: string;
  seconds: number;
}): Promise<{ txHash: string; paidWei: string }> {
  const address = requireReady();

  // Asked, not recomputed: the contract rounds when pro-rating a daily price, and a
  // client that reimplements that arithmetic eventually disagrees by one wei and reverts.
  const value = await publicClient.readContract({
    address: CONTRACT!,
    abi: LICENCE_ABI,
    functionName: "quote",
    args: [input.listing_id, BigInt(input.seconds)],
  });

  const hash = await walletClient(address).writeContract({
    address: CONTRACT!,
    abi: LICENCE_ABI,
    chain: avalancheFuji,
    account: address,
    functionName: "purchase",
    args: [input.listing_id, BigInt(input.seconds)],
    value,
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`purchase reverted: ${hash}`);

  await refreshBalance(address);
  return { txHash: hash, paidWei: value.toString() };
}

/** What the contract owes this address, pending withdrawal. */
export async function readOwed(address: `0x${string}`): Promise<bigint> {
  if (!CONTRACT) return 0n;
  return publicClient.readContract({
    address: CONTRACT,
    abi: LICENCE_ABI,
    functionName: "owed",
    args: [address],
  });
}

export async function withdrawEarnings(): Promise<string> {
  const address = requireReady();

  const hash = await walletClient(address).writeContract({
    address: CONTRACT!,
    abi: LICENCE_ABI,
    chain: avalancheFuji,
    account: address,
    functionName: "withdraw",
    args: [],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`withdraw reverted: ${hash}`);

  await refreshBalance(address);
  return hash;
}

export function formatAvaxBalance(wei: bigint | null, places = 4): string {
  if (wei === null) return "—";
  const value = Number(formatEther(wei));
  return value.toFixed(places).replace(/\.?0+$/, "") || "0";
}
