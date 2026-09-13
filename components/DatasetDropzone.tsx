"use client";

import { useCallback, useRef, useState } from "react";
import { FileUp, Sparkles, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { detectSchema, parseCsv, type DetectedSchema, type ParsedDataset } from "@/lib/csv";
import { COLUMNS, generateRows, toCsv } from "@/lib/dataset";

const MAX_BYTES = 4 * 1024 * 1024;

export type LoadedDataset = {
  name: string;
  csv: string;
  dataset: ParsedDataset;
  schema: DetectedSchema;
};

export function DatasetDropzone({
  loaded,
  onLoad,
}: {
  loaded: LoadedDataset | null;
  onLoad: (dataset: LoadedDataset | null) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const ingest = useCallback(
    async (name: string, csv: string) => {
      setError(null);
      try {
        // Size is checked before parsing: the failure mode of a huge file is a frozen
        // tab, which looks like the app is broken rather than like a rejected input.
        if (csv.length > MAX_BYTES) {
          throw new Error(`File is larger than ${MAX_BYTES / 1024 / 1024} MB.`);
        }
        const dataset = parseCsv(csv);
        onLoad({ name, csv, dataset, schema: detectSchema(dataset) });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Could not read that file.");
        onLoad(null);
      }
    },
    [onLoad],
  );

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!/\.(csv|txt)$/i.test(file.name)) {
        setError("Drop a .csv file.");
        return;
      }
      await ingest(file.name, await file.text());
    },
    [ingest],
  );

  function useSynthetic() {
    const rows = generateRows(800);
    void ingest("synthetic-wearables.csv", toCsv(rows));
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          void handleFiles(event.dataTransfer.files);
        }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center transition-colors ${
          dragging
            ? "border-primary bg-primary/5"
            : "border-border hover:border-muted-foreground/50"
        }`}
      >
        <FileUp className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">
          {loaded ? loaded.name : "Drop a CSV, or click to choose"}
        </p>
        <p className="max-w-sm text-xs text-muted-foreground">
          It is encrypted in this tab before anything leaves. Only ciphertext reaches
          Swarm, and the key never goes anywhere.
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,text/csv,text/plain"
          className="hidden"
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={useSynthetic}>
          <Sparkles className="size-3.5" />
          Use synthetic wearables ({COLUMNS.length} columns, 800 rows)
        </Button>
        {loaded && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onLoad(null)}>
            Clear
          </Button>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 text-xs text-destructive">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
          {error}
        </p>
      )}

      {loaded && <SchemaPreview loaded={loaded} />}
    </div>
  );
}

function SchemaPreview({ loaded }: { loaded: LoadedDataset }) {
  const { schema } = loaded;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium">{schema.rowCount.toLocaleString()} rows</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-muted-foreground">
          {schema.columns.length} columns detected
        </span>
        {schema.suggestedLabel && (
          <Badge variant="secondary" className="font-mono text-[10px]">
            label: {schema.suggestedLabel}
          </Badge>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {schema.columns.map((column) => (
          <Badge
            key={column.name}
            variant={column.name === schema.suggestedLabel ? "default" : "outline"}
            className="font-mono text-[10px]"
          >
            {column.name}
            <span className="ml-1 opacity-60">{column.kind}</span>
          </Badge>
        ))}
      </div>

      {schema.warnings.length > 0 && (
        <ul className="space-y-1">
          {schema.warnings.map((warning) => (
            <li key={warning} className="flex items-start gap-2 text-xs text-warning">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-muted-foreground">
        Only column names and a SHA-256 commitment to them go on Arkiv. No values are
        published anywhere.
      </p>
    </div>
  );
}
