"use client";

import { useCallback, useEffect, useState } from "react";
import { TransportBadge } from "@/components/TransportBadge";
import { encryptDataset, exportKey, generateDatasetKey, importKey, schemaHash } from "@/lib/crypto";
import { COLUMNS, fromCsv, generateRows, toCsv } from "@/lib/dataset";
import { connectSwarm, downloadFromSwarm, initSwarm, onSwarmStatus, uploadToSwarm, type SwarmStatus } from "@/lib/swarm";
import { trainLogistic, type TrainedModel } from "@/lib/training";
import { useEntityStream } from "@/lib/useEntityStream";
import { decryptDataset } from "@/lib/crypto";

type Listing = { key: string; listing_id: string; swarmHash: string; row_count: number };
type JobLog = { at: string; text: string };

/**
 * The seller's side, and the only place a plaintext row ever exists.
 *
 * The dataset is encrypted here, uploaded here as ciphertext, and decrypted here when
 * a licensed job arrives. Nothing on the server and nothing in the buyer's browser
 * ever holds the key.
 */
export default function SellPage() {
  const [swarm, setSwarm] = useState<SwarmStatus | null>(null);
  const [row_count, setRowCount] = useState(800);
  const [price, setPrice] = useState("2000000000000000");
  const [region, setRegion] = useState("EU");
  const [busy, setBusy] = useState<string | null>(null);
  const [listings, setListings] = useState<Listing[]>([]);
  const [log, setLog] = useState<JobLog[]>([]);
  const [model, setModel] = useState<TrainedModel | null>(null);

  useEffect(() => onSwarmStatus(setSwarm), []);
  useEffect(() => {
    initSwarm().catch(() => {});
  }, []);

  const note = useCallback((text: string) => {
    setLog((entries) => [{ at: new Date().toLocaleTimeString(), text }, ...entries].slice(0, 30));
  }, []);

  /**
   * A licensed job landed. Decrypt locally, train locally, publish only the weights.
   * Triggered by the websocket stream, so the seller does not have to be watching.
   */
  const onGrant = useCallback(
    async (entityKey: string) => {
      try {
        const detail = await fetch(`/api/grants/detail?key=${entityKey}`).then((r) => r.json());
        if (detail.error) return;

        const listing_id: string = detail.attributes?.listing_id;
        const stored = localStorage.getItem(`vespro:key:${listing_id}`);
        const meta = localStorage.getItem(`vespro:meta:${listing_id}`);
        if (!stored || !meta) return;

        note(`Licence sold for ${listing_id} — decrypting locally`);

        const { swarmHash, iv } = JSON.parse(meta);
        const ciphertext = await downloadFromSwarm(swarmHash);
        const plaintext = await decryptDataset(await importKey(stored), { ciphertext, iv });
        const rows = fromCsv(new TextDecoder().decode(plaintext));

        note(`Training on ${rows.length} rows — the buyer receives weights only`);
        const spec = detail.payload?.jobSpec ?? { epochs: 40, learningRate: 0.05 };
        const trained = trainLogistic(rows, { epochs: spec.epochs, learningRate: spec.learningRate });
        setModel(trained);

        await fetch("/api/grants/result", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ entityKey, result: trained }),
        });

        note(`Published weights (accuracy ${(trained.accuracy * 100).toFixed(1)}%) — no rows left this browser`);
      } catch (error) {
        note(`Job failed: ${error instanceof Error ? error.message : "unknown"}`);
      }
    },
    [note],
  );

  const stream = useEntityStream((event) => {
    if (event.name === "EntityCreated") void onGrant(event.entityKey);
  });

  async function publish() {
    setBusy("Generating and encrypting");
    try {
      const listing_id = `fit-${Date.now().toString(36)}`;
      const rows = generateRows(row_count);
      const plaintext = new TextEncoder().encode(toCsv(rows));

      const key = await generateDatasetKey();
      const { ciphertext, iv } = await encryptDataset(key, plaintext);

      setBusy("Uploading ciphertext to Swarm");
      const swarmHash = await uploadToSwarm(ciphertext);

      // The key stays here. This is the whole architecture in one line.
      localStorage.setItem(`vespro:key:${listing_id}`, await exportKey(key));
      localStorage.setItem(`vespro:meta:${listing_id}`, JSON.stringify({ swarmHash, iv }));

      setBusy("Writing the Arkiv listing");
      const response = await fetch("/api/listings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listing_id,
          domain: "fitness",
          metric: "heart_rate",
          row_count: rows.length,
          price_per_day_wei: price,
          region,
          schema_hash: await schemaHash(COLUMNS.map((c) => c.name)),
          swarmHash,
          sampleSwarmHash: null,
          columns: COLUMNS,
          description: `${rows.length} synthetic wearable records, recovery label included.`,
          iv,
        }),
      }).then((r) => r.json());

      if (response.error) throw new Error(response.error);

      setListings((current) => [
        { key: response.entityKey, listing_id, swarmHash, row_count: rows.length },
        ...current,
      ]);
      note(`Listed ${listing_id} — ${(ciphertext.byteLength / 1024).toFixed(1)} KiB of ciphertext on Swarm`);
    } catch (error) {
      note(`Publish failed: ${error instanceof Error ? error.message : "unknown"}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl font-semibold tracking-tight">Sell access, not data</h1>
        <p className="mt-2 max-w-2xl text-sm text-neutral-400">
          Your rows are encrypted in this browser and stored on Swarm as ciphertext. Buyers
          licence the dataset and send a training job; this tab decrypts, trains, and returns
          model weights. The key never leaves, and neither do the rows.
        </p>
      </section>

      <section className="rounded-lg border border-neutral-800 p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-sm font-medium">Swarm ID</h2>
          <span className="text-xs text-neutral-500">
            {swarm?.identityName ?? "not connected"}
          </span>
        </div>
        {swarm?.reason && <p className="mt-2 text-xs text-amber-400">{swarm.reason}</p>}
        {!swarm?.canUpload && (
          <button
            onClick={() => void connectSwarm()}
            className="mt-3 rounded bg-neutral-100 px-3 py-1.5 text-xs font-medium text-neutral-900 hover:bg-white"
          >
            Connect Swarm ID
          </button>
        )}
      </section>

      <section className="rounded-lg border border-neutral-800 p-5">
        <h2 className="text-sm font-medium">Publish a dataset</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="text-xs text-neutral-400">
            Rows
            <input
              type="number"
              value={row_count}
              onChange={(e) => setRowCount(Number(e.target.value))}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
          <label className="text-xs text-neutral-400">
            Price per day (wei)
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            />
          </label>
          <label className="text-xs text-neutral-400">
            Region
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="mt-1 w-full rounded border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-sm text-neutral-100"
            >
              <option>EU</option>
              <option>US</option>
              <option>APAC</option>
            </select>
          </label>
        </div>
        <button
          onClick={() => void publish()}
          disabled={Boolean(busy) || !swarm?.canUpload}
          className="mt-4 rounded bg-emerald-500 px-4 py-2 text-sm font-medium text-neutral-950 disabled:opacity-40"
        >
          {busy ?? "Encrypt, upload and list"}
        </button>

        {listings.length > 0 && (
          <ul className="mt-4 space-y-2 text-xs text-neutral-400">
            {listings.map((listing) => (
              <li key={listing.key} className="rounded border border-neutral-800 p-2 font-mono">
                {listing.listing_id} · {listing.row_count} rows · swarm:{listing.swarmHash.slice(0, 12)}…
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-neutral-800 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium">Live licence feed</h2>
          <TransportBadge state={stream} />
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Pushed from an Arkiv subscription. Nothing here refreshes on a timer.
        </p>

        <ul className="mt-4 space-y-1.5 text-xs">
          {log.length === 0 && <li className="text-neutral-600">Waiting for a sale…</li>}
          {log.map((entry, index) => (
            <li key={index} className="flex gap-3">
              <span className="shrink-0 font-mono text-neutral-600">{entry.at}</span>
              <span className="text-neutral-300">{entry.text}</span>
            </li>
          ))}
        </ul>

        {model && (
          <div className="mt-4 rounded border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs">
            <p className="font-medium text-emerald-300">Last model returned to a buyer</p>
            <pre className="mt-2 overflow-x-auto font-mono text-neutral-300">
{JSON.stringify({ weights: model.weights, bias: model.bias, accuracy: model.accuracy, rowsUsed: model.rowsUsed }, null, 2)}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
