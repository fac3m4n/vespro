"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { BrainCircuit, Lock, ShieldCheck, Upload } from "lucide-react";
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
import { DatasetDropzone, type LoadedDataset } from "@/components/DatasetDropzone";
import { EvidencePanel } from "@/components/EvidencePanel";
import { TransportBadge } from "@/components/TransportBadge";
import {
  decryptDataset,
  encryptDataset,
  exportKey,
  generateDatasetKey,
  importKey,
  schemaHash,
} from "@/lib/crypto";
import { parseCsv, toMatrix } from "@/lib/csv";
import { record } from "@/lib/evidence";
import { avaxToWei } from "@/lib/price";
import {
  connectSwarm,
  downloadFromSwarm,
  initSwarm,
  onSwarmStatus,
  uploadToSwarm,
  type SwarmStatus,
} from "@/lib/swarm";
import { trainLogistic, type TrainedModel } from "@/lib/training";
import { useEntityStream } from "@/lib/useEntityStream";

type Published = {
  entityKey: string;
  listing_id: string;
  rows: number;
  swarmHash: string;
};

/**
 * The seller's side, and the only place a plaintext row ever exists.
 *
 * The dataset is encrypted here, uploaded here as ciphertext, and decrypted here when a
 * licensed job arrives. Nothing on the server and nothing in the buyer's browser ever
 * holds the key.
 */
export default function SellPage() {
  const [swarm, setSwarm] = useState<SwarmStatus | null>(null);
  const [loaded, setLoaded] = useState<LoadedDataset | null>(null);
  const [priceAvax, setPriceAvax] = useState("0.05");
  const [metric, setMetric] = useState("heart_rate");
  const [region, setRegion] = useState("EU");
  const [busy, setBusy] = useState(false);
  const [published, setPublished] = useState<Published[]>([]);
  const [model, setModel] = useState<TrainedModel | null>(null);

  useEffect(() => onSwarmStatus(setSwarm), []);
  useEffect(() => {
    initSwarm().catch(() => {});
  }, []);

  /**
   * A licensed job landed. Decrypt locally, train locally, publish only the weights.
   * Driven by the websocket stream, so the seller does not have to be watching.
   */
  const onEntityCreated = useCallback(async (entityKey: string) => {
    try {
      const detail = await fetch(`/api/grants/detail?key=${entityKey}`).then((r) => r.json());
      if (detail.error || detail.attributes?.kind !== "grant") return;

      const listing_id: string = detail.attributes.listing_id;
      const storedKey = localStorage.getItem(`vespro:key:${listing_id}`);
      const storedMeta = localStorage.getItem(`vespro:meta:${listing_id}`);
      if (!storedKey || !storedMeta) return;

      const jobToast = toast.loading(`Licence sold for ${listing_id}`, {
        description: "Fetching ciphertext from Swarm…",
      });

      const { swarmHash, iv, features, label } = JSON.parse(storedMeta);
      const ciphertext = await downloadFromSwarm(swarmHash);

      toast.loading("Decrypting locally", {
        id: jobToast,
        description: "The key never left this browser.",
      });
      const plaintext = await decryptDataset(await importKey(storedKey), { ciphertext, iv });

      const dataset = parseCsv(new TextDecoder().decode(plaintext));
      const { x, y } = toMatrix(dataset, features, label);

      toast.loading(`Training on ${x.length} rows`, {
        id: jobToast,
        description: "The buyer receives weights only.",
      });

      const spec = detail.payload?.jobSpec ?? { epochs: 40, learningRate: 0.05 };
      const trained = trainLogistic(
        { x, y, featureNames: features, labelName: label },
        { epochs: spec.epochs, learningRate: spec.learningRate },
      );
      setModel(trained);

      const result = await fetch("/api/grants/result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityKey, result: trained }),
      }).then((r) => r.json());

      if (result.txHash) record("arkiv-tx", "weights returned", result.txHash);

      toast.success(`Model returned — ${(trained.accuracy * 100).toFixed(1)}% accuracy`, {
        id: jobToast,
        description: `${x.length} rows used. No rows left this browser.`,
      });
    } catch (error) {
      toast.error("Training job failed", {
        description: error instanceof Error ? error.message : "unknown error",
      });
    }
  }, []);

  const stream = useEntityStream((event) => {
    if (event.name === "EntityCreated") void onEntityCreated(event.entityKey);
  });

  async function publish() {
    if (!loaded) return;

    const { schema, dataset } = loaded;
    const label = schema.suggestedLabel;
    if (!label || schema.featureCandidates.length === 0) {
      toast.error("This dataset cannot be trained on", {
        description: schema.warnings[0] ?? "Need numeric features and a 0/1 label column.",
      });
      return;
    }

    setBusy(true);
    const progress = toast.loading("Encrypting in this browser", {
      description: "AES-256-GCM. Plaintext never leaves the tab.",
    });

    try {
      const price_per_day_wei = avaxToWei(priceAvax);
      const listing_id = `fit-${Date.now().toString(36)}`;
      const plaintext = new TextEncoder().encode(loaded.csv);

      const key = await generateDatasetKey();
      const { ciphertext, iv } = await encryptDataset(key, plaintext);

      toast.loading("Uploading ciphertext to Swarm", {
        id: progress,
        description: `${(ciphertext.byteLength / 1024).toFixed(1)} KiB`,
      });
      const swarmHash = await uploadToSwarm(ciphertext);
      record("swarm-ref", "dataset ciphertext", swarmHash);

      // The key stays here. This is the whole architecture in one line.
      localStorage.setItem(`vespro:key:${listing_id}`, await exportKey(key));
      localStorage.setItem(
        `vespro:meta:${listing_id}`,
        JSON.stringify({
          swarmHash,
          iv,
          features: schema.featureCandidates,
          label,
        }),
      );

      toast.loading("Registering terms on Avalanche Fuji", {
        id: progress,
        description: "The asset rule goes onchain before anyone can pay it.",
      });

      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id,
          domain: "fitness",
          metric,
          row_count: dataset.rows.length,
          price_per_day_wei: price_per_day_wei.toString(),
          region,
          schema_hash: await schemaHash(dataset.header),
          swarmHash,
          columns: dataset.header.map((name) => ({ name, unit: "" })),
          description: `${dataset.rows.length} rows, ${schema.featureCandidates.length} features, label "${label}".`,
          iv,
        }),
      }).then((r) => r.json());

      if (response.error) throw new Error(response.error);

      record("arkiv-entity", "listing", response.entityKey);
      record("arkiv-tx", "listing created", response.txHash);
      if (response.terms?.txHash) record("fuji-tx", "terms registered", response.terms.txHash);

      setPublished((current) => [
        { entityKey: response.entityKey, listing_id, rows: dataset.rows.length, swarmHash },
        ...current,
      ]);

      toast.success(`Listed ${listing_id}`, {
        id: progress,
        description: response.terms?.registered
          ? "Live on Arkiv, terms registered on Fuji."
          : `Live on Arkiv. Fuji terms failed: ${response.terms?.note ?? "unknown"}`,
      });
    } catch (error) {
      toast.error("Publish failed", {
        id: progress,
        description: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  const canPublish = Boolean(loaded && swarm?.canUpload && !busy);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sell access, not data</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">
          Your rows are encrypted in this browser and stored on Swarm as ciphertext.
          Buyers licence the dataset and send a training job; this tab decrypts, trains,
          and returns model weights. The key never leaves, and neither do the rows.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-muted-foreground" />
              <CardTitle className="text-sm">Swarm ID</CardTitle>
            </div>
            <Badge variant={swarm?.canUpload ? "default" : "secondary"}>
              {swarm?.canUpload
                ? (swarm.identityName ?? "connected")
                : (swarm?.reason ?? "connecting…")}
            </Badge>
          </div>
        </CardHeader>
        {!swarm?.canUpload && (
          <CardContent>
            <Button size="sm" onClick={() => void connectSwarm()}>
              Connect Swarm ID
            </Button>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">1. Your dataset</CardTitle>
          <CardDescription className="text-xs">
            Dropped files are parsed in the browser. Nothing is uploaded until you publish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DatasetDropzone loaded={loaded} onLoad={setLoaded} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">2. Terms</CardTitle>
          <CardDescription className="text-xs">
            Published onchain before anyone can buy, so the price a buyer pays is the price
            you set.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="price" className="text-xs">
                Price per day
              </Label>
              <div className="relative">
                <Input
                  id="price"
                  value={priceAvax}
                  onChange={(event) => setPriceAvax(event.target.value)}
                  inputMode="decimal"
                  className="pr-14"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  AVAX
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground">
                A 60-second licence costs {shortPrice(priceAvax)}.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Metric</Label>
              <Select value={metric} onValueChange={setMetric}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="heart_rate">heart_rate</SelectItem>
                  <SelectItem value="sleep">sleep</SelectItem>
                  <SelectItem value="steps">steps</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Region</Label>
              <Select value={region} onValueChange={setRegion}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="EU">EU</SelectItem>
                  <SelectItem value="US">US</SelectItem>
                  <SelectItem value="APAC">APAC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button onClick={() => void publish()} disabled={!canPublish}>
            {busy ? (
              "Working…"
            ) : (
              <>
                <Lock className="size-3.5" />
                Encrypt, upload and list
              </>
            )}
          </Button>

          {!swarm?.canUpload && (
            <p className="text-xs text-amber-500">
              Connect Swarm ID with a usable postage batch before publishing.
            </p>
          )}

          {published.length > 0 && (
            <ul className="space-y-1.5 border-t pt-3">
              {published.map((item) => (
                <li key={item.entityKey} className="font-mono text-xs text-muted-foreground">
                  {item.listing_id} · {item.rows.toLocaleString()} rows
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-sm">
                <BrainCircuit className="size-4 text-muted-foreground" />
                3. Live licence feed
              </CardTitle>
              <CardDescription className="text-xs">
                Pushed from an Arkiv subscription. Nothing here refreshes on a timer.
              </CardDescription>
            </div>
            <TransportBadge state={stream} />
          </div>
        </CardHeader>
        <CardContent>
          {model ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-emerald-400">
                Last model returned to a buyer
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <Stat label="Rows used" value={model.rowsUsed.toLocaleString()} />
                <Stat label="Accuracy" value={`${(model.accuracy * 100).toFixed(1)}%`} />
                <Stat label="Base rate" value={`${(model.baseRate * 100).toFixed(1)}%`} />
              </div>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-[11px]">
{JSON.stringify(
  Object.fromEntries(model.featureNames.map((n, i) => [n, model.weights[i]])),
  null,
  2,
)}
              </pre>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Upload className="size-3.5" />
              Waiting for a sale. Buy a licence from the marketplace in another window.
            </p>
          )}
        </CardContent>
      </Card>

      <EvidencePanel />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border px-3 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-sm">{value}</p>
    </div>
  );
}

function shortPrice(priceAvax: string): string {
  const perDay = Number(priceAvax);
  if (!Number.isFinite(perDay) || perDay <= 0) return "nothing";
  const perMinute = (perDay / 1440) * 1;
  return `${(perMinute * 1).toFixed(8).replace(/\.?0+$/, "")} AVAX`;
}
