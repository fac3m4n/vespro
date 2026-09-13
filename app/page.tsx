"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  Clock,
  Database,
  ExternalLink,
  KeyRound,
  Lock,
  Search,
  Sparkles,
} from "lucide-react";
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
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { EvidencePanel } from "@/components/EvidencePanel";
import { TransportBadge } from "@/components/TransportBadge";
import { QueryBlock } from "@/components/QueryBlock";
import { ModelWeights } from "@/components/ModelWeights";
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

const STEPS = [
  { icon: Lock, title: "Owner encrypts", body: "The key never leaves their browser." },
  { icon: KeyRound, title: "You licence a term", body: "Paid on Fuji, granted on Arkiv." },
  { icon: Sparkles, title: "You get weights", body: "Never the rows, never the key." },
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
  const [loading, setLoading] = useState(true);

  const browse = useCallback(async () => {
    try {
      const params = new URLSearchParams({ domain: "fitness" });
      if (Number(minRows) > 0) params.set("minRows", String(Math.floor(Number(minRows))));
      if (Number(maxPriceAvax) > 0) {
        params.set("maxPrice", BigInt(Math.floor(Number(maxPriceAvax) * 1e18)).toString());
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
    } finally {
      setLoading(false);
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
    <div className="space-y-12">
      <section className="space-y-6">
        <Badge variant="secondary" className="gap-1.5 rounded-full py-1 pl-1.5 pr-3">
          <span className="grid size-4 place-items-center rounded-full bg-success/20">
            <span className="size-1.5 rounded-full bg-success" />
          </span>
          Live on Arkiv Tiramisu
        </Badge>

        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight md:text-5xl">
          Train on data you are never given
        </h1>

        <p className="max-w-2xl text-lg leading-relaxed text-muted-foreground">
          Every dataset here stays encrypted on Swarm under its owner&apos;s key. You licence
          it for a term, send a training job, and get model weights back — no rows, no key.
        </p>

        <div className="grid gap-3 sm:grid-cols-3">
          {STEPS.map((step, index) => (
            <div key={step.title} className="rounded-lg border bg-card/50 p-4">
              <step.icon className="size-4 text-muted-foreground" />
              <p className="mt-3 text-sm font-medium">
                <span className="text-muted-foreground">{index + 1}. </span>
                {step.title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </section>

      <Separator />

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold tracking-tight">Browse datasets</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Filters become one compound query that Arkiv evaluates for you.
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="space-y-5 pt-6">
            <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="minRows">Minimum rows</Label>
                <Input
                  id="minRows"
                  value={minRows}
                  onChange={(event) => setMinRows(event.target.value)}
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="maxPrice">Max price per day</Label>
                <div className="relative">
                  <Input
                    id="maxPrice"
                    value={maxPriceAvax}
                    onChange={(event) => setMaxPriceAvax(event.target.value)}
                    inputMode="decimal"
                    className="pr-16"
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    AVAX
                  </span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Region</Label>
                <Select value={region} onValueChange={setRegion}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any region</SelectItem>
                    <SelectItem value="EU">EU</SelectItem>
                    <SelectItem value="US">US</SelectItem>
                    <SelectItem value="APAC">APAC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={() => void browse()}>
                <Search />
                Apply filters
              </Button>
            </div>

            {query && (
              <QueryBlock
                caption="Evaluated by Arkiv — not a full scan narrowed in JavaScript"
                query={query}
              />
            )}
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 pt-2">
          <Database className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-medium">
            {loading ? "Searching…" : `${listings.length} dataset${listings.length === 1 ? "" : "s"}`}
          </h3>
        </div>

        {loading && (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Card key={i}>
                <CardContent className="flex justify-between gap-4 pt-6">
                  <div className="w-full space-y-3">
                    <Skeleton className="h-5 w-52" />
                    <Skeleton className="h-4 w-full max-w-md" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-9 w-48 shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {!loading && listings.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-14 text-center">
              <div className="grid size-11 place-items-center rounded-full bg-muted">
                <Database className="size-5 text-muted-foreground" />
              </div>
              <div className="space-y-1.5">
                <p className="font-medium">No datasets listed right now</p>
                <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                  Listings expire on their own after 15 minutes — that is the same mechanism
                  the licences use. Publish one to fill the marketplace.
                </p>
              </div>
              <Button variant="outline" asChild>
                <a href="/sell">
                  Publish a dataset
                  <ArrowRight />
                </a>
              </Button>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {listings.map((listing) => {
            const pricePerDay = BigInt(listing.attributes.price_per_day_wei ?? "0");
            return (
              <Card key={listing.key} className="transition-colors hover:border-foreground/20">
                <CardContent className="flex flex-col gap-6 pt-6 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-medium">
                        {listing.payload.listing_id}
                      </span>
                      <Badge variant="secondary">{listing.attributes.region}</Badge>
                      <Badge variant="outline">{listing.attributes.metric}</Badge>
                    </div>

                    {listing.payload.description && (
                      <p className="max-w-xl text-sm text-muted-foreground">
                        {listing.payload.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
                      <span className="text-2xl font-semibold tracking-tight">
                        {formatAvax(pricePerDay)}
                      </span>
                      <span className="text-muted-foreground">AVAX / day</span>
                      <span className="text-muted-foreground">
                        · {Number(listing.attributes.row_count).toLocaleString()} rows
                      </span>
                    </div>

                    <ColumnBadges columns={listing.payload.columns} />
                  </div>

                  <div className="shrink-0 space-y-2 lg:text-right">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Licence for
                    </p>
                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {TERMS.map(({ option, seconds }) => (
                        <Button
                          key={option}
                          variant="outline"
                          disabled={busy}
                          onClick={() => void buy(listing, option)}
                          className="h-auto flex-col items-start gap-0.5 px-3 py-2"
                        >
                          <span className="font-medium">{option}</span>
                          <span className="font-mono text-[11px] font-normal text-muted-foreground">
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
      </section>

      {purchase && (
        <section className="space-y-5">
          <Separator />
          <Card className="border-success/30">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle className="flex items-center gap-2">
                    <Clock className="size-4 text-muted-foreground" />
                    Your licence
                  </CardTitle>
                  <CardDescription className="font-mono">
                    {purchase.listing_id} · {purchase.purchasedSeconds}s term
                  </CardDescription>
                </div>
                <TransportBadge state={stream} />
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <Countdown purchase={purchase} />

              {purchase.settlement.settled ? (
                <p className="text-sm text-muted-foreground">
                  Paid {formatAvax(purchase.settlement.paidWei ?? "0")} AVAX on Fuji ·{" "}
                  <a
                    href={purchase.settlement.explorerUrl ?? "#"}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-foreground underline decoration-dotted underline-offset-4"
                  >
                    view transaction
                    <ExternalLink className="size-3" />
                  </a>
                </p>
              ) : (
                <p className="text-sm text-warning">
                  Settlement skipped — {purchase.settlement.note ?? "Fuji not configured"}
                </p>
              )}

              <Separator />

              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-sm font-medium">Verify the licence yourself</p>
                    <p className="max-w-md text-sm text-muted-foreground">
                      Run it now, wait for the countdown, then run it again. Same query, and
                      no delete call in between.
                    </p>
                  </div>
                  <Button variant="outline" onClick={() => void checkAccess()}>
                    Run access check
                  </Button>
                </div>

                {access && (
                  <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">Licensed</span>
                      <Badge
                        variant="outline"
                        className={
                          access.licensed
                            ? "border-success/40 bg-success/10 text-success"
                            : "border-destructive/40 bg-destructive/10 text-destructive"
                        }
                      >
                        {String(access.licensed)}
                      </Badge>
                      <span className="ml-auto font-mono text-xs text-muted-foreground">
                        {new Date(access.checkedAt).toLocaleTimeString()}
                      </span>
                    </div>
                    <QueryBlock query={access.query} />
                  </div>
                )}
              </div>

              {weights && (
                <ModelWeights
                  model={weights}
                  stat="accuracy"
                  title="Model received — trained on rows you never saw"
                />
              )}
            </CardContent>
          </Card>
        </section>
      )}

      <EvidencePanel />
    </div>
  );
}

/**
 * Payloads are opaque bytes chosen by whoever wrote the entity, so a listing can carry
 * columns in a shape this page never produced. Anything without a usable name is dropped
 * rather than rendered as an empty pill.
 */
function ColumnBadges({ columns }: { columns: { name: string }[] | undefined }) {
  const names = (columns ?? [])
    .map((column) => (typeof column?.name === "string" ? column.name : ""))
    .filter(Boolean);

  if (names.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {names.slice(0, 8).map((name, index) => (
        <Badge
          key={`${name}-${index}`}
          variant="outline"
          className="font-mono text-[11px] font-normal text-muted-foreground"
        >
          {name}
        </Badge>
      ))}
      {names.length > 8 && (
        <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
          +{names.length - 8} more
        </Badge>
      )}
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
    <div className="space-y-3">
      <div className="flex items-baseline justify-between gap-4">
        <p
          className={`font-mono text-5xl font-medium tabular-nums ${
            expired ? "text-destructive" : "text-success"
          }`}
        >
          {expired ? "expired" : `${remaining.toFixed(1)}s`}
        </p>
        <p className="text-xs text-muted-foreground">
          {expired ? "the entity is gone" : "time left on the entity"}
        </p>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all duration-200 ${
            expired ? "bg-destructive" : "bg-success"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        This is the Arkiv entity&apos;s own lifetime, not a timer this app enforces. Nothing
        will delete it.
      </p>
    </div>
  );
}
