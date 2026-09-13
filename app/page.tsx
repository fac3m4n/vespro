"use client";

import { useCallback, useEffect, useState } from "react";
import { TransportBadge } from "@/components/TransportBadge";
import { useEntityStream } from "@/lib/useEntityStream";
import type { LicenceOption } from "@/lib/arkiv/schema";

type Listing = {
  key: string;
  owner: string;
  expiresAt: string;
  attributes: Record<string, string>;
  payload: { listingId: string; swarmHash: string; description: string; columns: { name: string }[] };
};

type AccessCheck = { licensed: boolean; query: string; checkedAt: string };

type Purchase = {
  entityKey: string;
  listingId: string;
  purchasedSeconds: number;
  settlement: { settled: boolean; txHash: string; explorerUrl: string | null; note?: string };
  boughtAt: number;
};

const OPTIONS: LicenceOption[] = ["60s", "2min", "10min"];

export default function MarketplacePage() {
  const [minRows, setMinRows] = useState(500);
  const [maxPrice, setMaxPrice] = useState("5000000000000000");
  const [region, setRegion] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [query, setQuery] = useState("");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [access, setAccess] = useState<AccessCheck | null>(null);
  const [weights, setWeights] = useState<Record<string, unknown> | null>(null);
  const [buyer, setBuyer] = useState<string>("");
  const [busy, setBusy] = useState<string | null>(null);

  const browse = useCallback(async () => {
    setBusy("Querying Arkiv");
    try {
      const params = new URLSearchParams({ domain: "fitness", minRows: String(minRows) });
      if (maxPrice) params.set("maxPrice", maxPrice);
      if (region) params.set("region", region);

      const data = await fetch(`/api/listings?${params}`).then((r) => r.json());
      setListings(data.listings ?? []);
      setQuery(data.query ?? "");
    } finally {
      setBusy(null);
    }
  }, [minRows, maxPrice, region]);

  useEffect(() => {
    void browse();
    fetch("/api/whoami")
      .then((r) => r.json())
      .then((d) => setBuyer(d.buyer ?? ""))
      .catch(() => {});
  }, [browse]);

  /** The weights arrive as a patch to the grant we are already watching. */
  const stream = useEntityStream((event) => {
    if (event.name !== "EntityPatched" || !purchase) return;
    if (event.entityKey.toLowerCase() !== purchase.entityKey.toLowerCase()) return;

    fetch(`/api/grants/detail?key=${purchase.entityKey}`)
      .then((r) => r.json())
      .then((detail) => {
        if (detail?.payload?.trained) setWeights(detail.payload.trained);
      })
      .catch(() => {});
  });

  async function buy(listing: Listing, option: LicenceOption) {
    setBusy(`Settling and licensing (${option})`);
    setWeights(null);
    setAccess(null);
    try {
      const result = await fetch("/api/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId: listing.payload.listingId,
          owner: listing.owner,
          option,
          pricePerDayWei: listing.attributes.pricePerDayWei,
          jobSpec: { model: "logistic-regression", epochs: 40, learningRate: 0.05 },
        }),
      }).then((r) => r.json());

      if (result.error) throw new Error(result.error);

      setPurchase({
        entityKey: result.entityKey,
        listingId: listing.payload.listingId,
        purchasedSeconds: result.purchasedSeconds,
        settlement: result.settlement,
        boughtAt: Date.now(),
      });
    } catch (error) {
      alert(error instanceof Error ? error.message : "purchase failed");
    } finally {
      setBusy(null);
    }
  }

  async function checkAccess() {
    if (!purchase || !buyer) return;
    const params = new URLSearchParams({ listingId: purchase.listingId, buyer });
    setAccess(await fetch(`/api/grants?${params}`).then((r) => r.json()));
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">
          Train on data you are never given
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Every dataset here stays encrypted on Swarm under its owner&apos;s key. You licence it,
          send a training job, and get model weights back. You do not receive rows, and you do
          not receive a key.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-800 p-5">
        <h2 className="text-sm font-medium">Filter</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <label className="text-xs text-neutral-400">
            Minimum rows
            <input
              type="number"
              value={minRows}
              onChange={(e) => setMinRows(Number(e.target.value))}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-neutral-400">
            Max price/day (wei)
            <input
              value={maxPrice}
              onChange={(e) => setMaxPrice(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            />
          </label>
          <label className="text-xs text-neutral-400">
            Region
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm"
            >
              <option value="">any</option>
              <option value="EU">EU</option>
              <option value="US">US</option>
              <option value="APAC">APAC</option>
            </select>
          </label>
          <button
            onClick={() => void browse()}
            className="mt-auto rounded bg-neutral-100 px-3 py-2 text-sm font-medium text-neutral-900 hover:bg-white"
          >
            {busy === "Querying Arkiv" ? "Querying…" : "Apply"}
          </button>
        </div>

        {query && (
          <div className="mt-4">
            <p className="text-xs text-neutral-500">
              One compound filter, executed by Arkiv — not a scan narrowed in JavaScript:
            </p>
            <pre className="mt-1 overflow-x-auto rounded bg-neutral-900 p-3 font-mono text-xs text-emerald-300">
{query}
            </pre>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">
          {listings.length} dataset{listings.length === 1 ? "" : "s"}
        </h2>
        {listings.length === 0 && (
          <p className="text-sm text-neutral-500">
            Nothing listed yet. Open <span className="font-mono">/sell</span> in a second window
            and publish one.
          </p>
        )}
        {listings.map((listing) => (
          <article key={listing.key} className="rounded-lg border border-neutral-800 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-mono text-sm">{listing.payload.listingId}</p>
                <p className="mt-1 text-xs text-neutral-400">{listing.payload.description}</p>
                <p className="mt-2 text-xs text-neutral-500">
                  {listing.attributes.rowCount} rows · {listing.attributes.metric} ·{" "}
                  {listing.attributes.region} · expires at block {listing.expiresAt ?? "—"}
                </p>
                <p className="mt-1 font-mono text-[11px] text-neutral-600">
                  swarm:{listing.payload.swarmHash?.slice(0, 24)}…
                </p>
              </div>
              <div className="flex flex-col gap-2">
                <span className="text-xs text-neutral-500">Licence for</span>
                <div className="flex gap-2">
                  {OPTIONS.map((option) => (
                    <button
                      key={option}
                      onClick={() => void buy(listing, option)}
                      disabled={Boolean(busy)}
                      className="rounded bg-emerald-500 px-3 py-1.5 text-xs font-medium text-neutral-950 disabled:opacity-40"
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </article>
        ))}
      </section>

      {purchase && (
        <section className="rounded-lg border border-neutral-800 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-medium">Your licence</h2>
            <TransportBadge state={stream} />
          </div>

          <Countdown purchase={purchase} />

          <div className="mt-3 text-xs text-neutral-400">
            {purchase.settlement.settled ? (
              <p>
                Settled on Avalanche Fuji ·{" "}
                <a
                  href={purchase.settlement.explorerUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-300 underline"
                >
                  {purchase.settlement.txHash.slice(0, 18)}…
                </a>
              </p>
            ) : (
              <p className="text-amber-400">
                Settlement skipped — {purchase.settlement.note ?? "Fuji not configured"}
              </p>
            )}
          </div>

          <button
            onClick={() => void checkAccess()}
            className="mt-4 rounded border border-neutral-700 px-3 py-1.5 text-xs hover:bg-neutral-900"
          >
            Run the access check
          </button>

          {access && (
            <div className="mt-3 space-y-2 text-xs">
              <p>
                Licensed:{" "}
                <span className={access.licensed ? "text-emerald-300" : "text-red-400"}>
                  {String(access.licensed)}
                </span>{" "}
                <span className="text-neutral-600">at {access.checkedAt}</span>
              </p>
              <pre className="overflow-x-auto rounded bg-neutral-900 p-3 font-mono text-emerald-300">
{access.query}
              </pre>
              <p className="text-neutral-500">
                Run this before and after the countdown hits zero. Same query, no delete call
                in between — the row simply stops existing.
              </p>
            </div>
          )}

          {weights && (
            <div className="mt-4 rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
              <p className="font-medium text-emerald-300">
                Model received — trained on rows you never saw
              </p>
              <pre className="mt-2 overflow-x-auto font-mono text-neutral-300">
{JSON.stringify(weights, null, 2)}
              </pre>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Shows the licence term running out, so the boundary is visible on camera. */
function Countdown({ purchase }: { purchase: Purchase }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const elapsed = (now - purchase.boughtAt) / 1000;
  const remaining = Math.max(0, purchase.purchasedSeconds - elapsed);
  const expired = remaining <= 0;

  return (
    <div className="mt-3">
      <p className={`font-mono text-2xl ${expired ? "text-red-400" : "text-emerald-300"}`}>
        {expired ? "licence lapsed" : `${remaining.toFixed(1)}s remaining`}
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        This is the entity&apos;s lifetime, not a timer the app enforces. Nothing will delete it.
      </p>
    </div>
  );
}
