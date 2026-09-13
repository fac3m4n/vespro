"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Clock, Database, ExternalLink, Search, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EvidencePanel } from "@/components/EvidencePanel";
import { TransportBadge } from "@/components/TransportBadge";
import { record } from "@/lib/evidence";
import { formatAvax, proRatedWei } from "@/lib/price";
import { useEntityStream } from "@/lib/useEntityStream";
import type { LicenceOption } from "@/lib/arkiv/schema";

type Listing = {
  key: string;
  owner: string;
  expiresAt: string;
  attributes: Record<string, string>;
  payload: {
    listing_id: string;
    swarmHash: string;
    description: string;
    columns: { name: string }[];
  };
};

type AccessCheck = { licensed: boolean; query: string; checkedAt: string };

type Purchase = {
  entityKey: string;
  listing_id: string;
  purchasedSeconds: number;
  settlement: {
    settled: boolean;
    txHash: string;
    explorerUrl: string | null;
    paidWei?: string;
    note?: string;
  };
  expiresAtMs: number;
};

type Weights = {
  featureNames: string[];
  labelName: string;
  weights: number[];
  bias: number;
  accuracy: number;
  rowsUsed: number;
  baseRate: number;
};

const TERMS: { option: LicenceOption; seconds: number }[] = [
  { option: "60s", seconds: 60 },
  { option: "2min", seconds: 120 },
  { option: "10min", seconds: 600 },
];

export default function MarketplacePage() {
  const [minRows, setMinRows] = useState("100");
  const [maxPriceAvax, setMaxPriceAvax] = useState("1");
  const [region, setRegion] = useState("any");
  const [listings, setListings] = useState<Listing[]>([]);
  const [query, setQuery] = useState("");
  const [buyer, setBuyer] = useState("");
  const [purchase, setPurchase] = useState<Purchase | null>(null);
  const [access, setAccess] = useState<AccessCheck | null>(null);
  const [weights, setWeights] = useState<Weights | null>(null);
  const [busy, setBusy] = useState(false);

  const browse = useCallback(async () => {
    try {
      const params = new URLSearchParams({ domain: "fitness" });
      if (Number(minRows) > 0) params.set("minRows", String(Math.floor(Number(minRows))));
      if (Number(maxPriceAvax) > 0) {
        params.set("maxPrice", (BigInt(Math.floor(Number(maxPriceAvax) * 1e18))).toString());
      }
      if (region !== "any") params.set("region", region);

      const data = await fetch(`/api/listings?${params}`).then((r) => r.json());
      if (data.error) throw new Error(data.error);

      setListings(data.listings ?? []);
      setQuery(data.query ?? "");
      if (data.query) record("arkiv-query", "browse", data.query);
    } catch (error) {
      toast.error("Query failed", {
        description: error instanceof Error ? error.message : "unknown error",
      });
    }
  }, [minRows, maxPriceAvax, region]);

  useEffect(() => {
    // Both of these await before touching state, so neither is the synchronous
    // setState-in-effect the rule is guarding against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void browse();
    fetch("/api/whoami")
      .then((r) => r.json())
      .then((d) => setBuyer(d.buyer ?? ""))
      .catch(() => {});
    // Only on mount: browsing on every keystroke would hammer the node.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** The weights arrive as a patch to the grant we are already watching. */
  const stream = useEntityStream((event) => {
    if (event.name !== "EntityPatched" || !purchase) return;
    if (event.entityKey.toLowerCase() !== purchase.entityKey.toLowerCase()) return;

    fetch(`/api/grants/detail?key=${purchase.entityKey}`)
      .then((r) => r.json())
      .then((detail) => {
        if (!detail?.payload?.trained) return;
        setWeights(detail.payload.trained);
        toast.success("Model received", {
          description: "Trained on rows you were never given.",
        });
      })
      .catch(() => {});
  });

  async function buy(listing: Listing, option: LicenceOption) {
    setBusy(true);
    setWeights(null);
    setAccess(null);

    const progress = toast.loading(`Settling on Avalanche Fuji`, {
      description: `${option} licence for ${listing.payload.listing_id}`,
    });

    try {
      const result = await fetch("/api/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id: listing.payload.listing_id,
          owner: listing.owner,
          option,
          jobSpec: { model: "logistic-regression", epochs: 40, learningRate: 0.05 },
        }),
      }).then((r) => r.json());

      if (result.error) throw new Error(result.error);

      if (result.settlement?.settled) {
        record("fuji-tx", "licence paid", result.settlement.txHash);
      }
      record("arkiv-entity", "grant", result.entityKey);
      record("arkiv-tx", "grant created", result.txHash);

      setPurchase({
        entityKey: result.entityKey,
        listing_id: listing.payload.listing_id,
        purchasedSeconds: result.purchasedSeconds,
        settlement: result.settlement,
        expiresAtMs: result.expiresAtMs,
      });

      toast.success(`Licensed for ${option}`, {
        id: progress,
        description: result.settlement?.settled
          ? `Paid ${formatAvax(result.settlement.paidWei ?? "0")} on Fuji.`
          : `Settlement skipped: ${result.settlement?.note ?? "not configured"}`,
      });
    } catch (error) {
      toast.error("Purchase failed", {
        id: progress,
        description: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function checkAccess() {
    if (!purchase || !buyer) return;
    const params = new URLSearchParams({ listing_id: purchase.listing_id, buyer });
    const result: AccessCheck = await fetch(`/api/grants?${params}`).then((r) => r.json());
    setAccess(result);
    record("arkiv-query", `access check → ${result.licensed}`, result.query);

    if (result.licensed) {
      toast.success("Licensed", { description: "The grant still matches the query." });
    } else {
      toast.warning("Not licensed", {
        description: "Same query, no rows. The entity's lifetime ran out.",
      });
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Train on data you are never given
        </h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Every dataset here stays encrypted on Swarm under its owner&apos;s key. You
          licence it, send a training job, and get model weights back. You do not receive
          rows, and you do not receive a key.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Search className="size-4 text-muted-foreground" />
            Filter
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="minRows" className="text-xs">
                Minimum rows
              </Label>
              <Input
                id="minRows"
                value={minRows}
                onChange={(event) => setMinRows(event.target.value)}
                inputMode="numeric"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="maxPrice" className="text-xs">
                Max price per day
              </Label>
              <div className="relative">
                <Input
                  id="maxPrice"
                  value={maxPriceAvax}
                  onChange={(event) => setMaxPriceAvax(event.target.value)}
                  inputMode="decimal"
                  className="pr-14"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  AVAX
                </span>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">any</SelectItem>
                  <SelectItem value="EU">EU</SelectItem>
                  <SelectItem value="US">US</SelectItem>
                  <SelectItem value="APAC">APAC</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button className="mt-auto" onClick={() => void browse()}>
              Apply
            </Button>
          </div>

          {query && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">
                One compound filter, evaluated by Arkiv — not a scan narrowed in JavaScript:
              </p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] text-emerald-400">
{query}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Database className="size-4 text-muted-foreground" />
          {listings.length} dataset{listings.length === 1 ? "" : "s"}
        </h2>

        {listings.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Nothing listed yet. Open <span className="font-mono">/sell</span> in a second
              window and publish one.
            </CardContent>
          </Card>
        )}

        {listings.map((listing) => {
          const pricePerDay = BigInt(listing.attributes.price_per_day_wei ?? "0");
          return (
            <Card key={listing.key}>
              <CardContent className="flex flex-wrap items-start justify-between gap-4 py-5">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{listing.payload.listing_id}</span>
                    <Badge variant="secondary">{listing.attributes.region}</Badge>
                    <Badge variant="outline">{listing.attributes.metric}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {listing.payload.description}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {listing.payload.columns?.slice(0, 8).map((column) => (
                      <Badge key={column.name} variant="outline" className="font-mono text-[10px]">
                        {column.name}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs">
                    <span className="text-muted-foreground">
                      {Number(listing.attributes.row_count).toLocaleString()} rows ·{" "}
                    </span>
                    <span className="font-medium">{formatAvax(pricePerDay)}/day</span>
                  </p>
                </div>

                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">Licence for</p>
                  <div className="flex gap-2">
                    {TERMS.map(({ option, seconds }) => (
                      <Button
                        key={option}
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void buy(listing, option)}
                      >
                        {option}
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          {formatAvax(proRatedWei(pricePerDay, seconds), 8)}
                        </span>
                      </Button>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {purchase && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Clock className="size-4 text-muted-foreground" />
                  Your licence
                </CardTitle>
                <CardDescription className="text-xs">
                  {purchase.listing_id} · {purchase.purchasedSeconds}s term
                </CardDescription>
              </div>
              <TransportBadge state={stream} />
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <Countdown purchase={purchase} />

            {purchase.settlement.settled ? (
              <p className="text-xs text-muted-foreground">
                Paid {formatAvax(purchase.settlement.paidWei ?? "0")} on Avalanche Fuji ·{" "}
                <a
                  href={purchase.settlement.explorerUrl ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-foreground underline decoration-dotted"
                >
                  view transaction
                  <ExternalLink className="size-3" />
                </a>
              </p>
            ) : (
              <p className="text-xs text-amber-500">
                Settlement skipped — {purchase.settlement.note ?? "Fuji not configured"}
              </p>
            )}

            <div className="space-y-2">
              <Button variant="outline" size="sm" onClick={() => void checkAccess()}>
                Run the access check
              </Button>
              <p className="text-xs text-muted-foreground">
                Run it now, wait for the countdown, then run it again. Same query, no delete
                call in between.
              </p>
            </div>

            {access && (
              <div className="space-y-2">
                <p className="text-xs">
                  Licensed:{" "}
                  <span className={access.licensed ? "text-emerald-400" : "text-destructive"}>
                    {String(access.licensed)}
                  </span>
                  <span className="ml-2 text-muted-foreground">
                    {new Date(access.checkedAt).toLocaleTimeString()}
                  </span>
                </p>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px] text-emerald-400">
{access.query}
                </pre>
              </div>
            )}

            {weights && (
              <div className="space-y-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="flex items-center gap-2 text-xs font-medium text-emerald-400">
                  <Sparkles className="size-3.5" />
                  Model received — trained on rows you never saw
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  <Stat label="Rows used" value={weights.rowsUsed.toLocaleString()} />
                  <Stat label="Accuracy" value={`${(weights.accuracy * 100).toFixed(1)}%`} />
                  <Stat label="Predicting" value={weights.labelName} />
                </div>
                <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px]">
{JSON.stringify(
  Object.fromEntries(weights.featureNames.map((n, i) => [n, weights.weights[i]])),
  null,
  2,
)}
                </pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <EvidencePanel />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="truncate font-mono text-sm">{value}</p>
    </div>
  );
}

/** Shows the licence term running out, so the boundary is visible on camera. */
function Countdown({ purchase }: { purchase: Purchase }) {
  const [remaining, setRemaining] = useState(purchase.purchasedSeconds);

  useEffect(() => {
    // The clock is read inside the interval, never during render.
    const timer = setInterval(() => {
      setRemaining(Math.max(0, (purchase.expiresAtMs - Date.now()) / 1000));
    }, 250);
    return () => clearInterval(timer);
  }, [purchase.expiresAtMs]);

  const expired = remaining <= 0;
  const pct = (remaining / purchase.purchasedSeconds) * 100;

  return (
    <div className="space-y-2">
      <p
        className={`font-mono text-3xl tabular-nums ${
          expired ? "text-destructive" : "text-emerald-400"
        }`}
      >
        {expired ? "licence lapsed" : `${remaining.toFixed(1)}s`}
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all duration-200 ${
            expired ? "bg-destructive" : "bg-emerald-500"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        This is the Arkiv entity&apos;s lifetime, not a timer this app enforces. Nothing
        will delete it.
      </p>
    </div>
  );
}
