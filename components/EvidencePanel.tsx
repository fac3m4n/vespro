"use client";

import { useEffect, useState } from "react";
import { ExternalLink, ReceiptText, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  clearEvidence,
  onEvidence,
  truncate,
  type Evidence,
  type EvidenceKind,
} from "@/lib/evidence";

const LABELS: Record<EvidenceKind, string> = {
  "arkiv-entity": "Arkiv entity",
  "arkiv-tx": "Arkiv tx",
  "arkiv-query": "Query",
  "fuji-tx": "Fuji tx",
  "swarm-ref": "Swarm",
  local: "Local",
};

/**
 * The hues are load-bearing: at judging time the useful question is "which system did
 * that", and colour answers it faster than reading each label.
 */
const TONES: Record<EvidenceKind, string> = {
  "arkiv-entity": "border-success/25 bg-success/10 text-success",
  "arkiv-tx": "border-success/25 bg-success/10 text-success",
  "arkiv-query": "border-sky-500/25 bg-sky-500/10 text-sky-400",
  "fuji-tx": "border-red-500/25 bg-red-500/10 text-red-400",
  "swarm-ref": "border-orange-500/25 bg-orange-500/10 text-orange-400",
  local: "border-border bg-muted text-muted-foreground",
};

/**
 * Everything provable this session produced.
 *
 * Exists so that at judging time the answer to "can you show me that actually
 * happened" is a link on screen rather than a scroll through a terminal.
 */
export function EvidencePanel() {
  const [entries, setEntries] = useState<Evidence[]>([]);

  useEffect(() => onEvidence(setEntries), []);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <ReceiptText className="size-4 text-muted-foreground" />
              Evidence
              {entries.length > 0 && (
                <Badge variant="secondary" className="ml-1 rounded-full">
                  {entries.length}
                </Badge>
              )}
            </CardTitle>
            <CardDescription>
              Every transaction, entity and query this session produced.
            </CardDescription>
          </div>
          {entries.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearEvidence}>
              <Trash2 />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Nothing yet. Publish a dataset or buy a licence.
          </p>
        ) : (
          <ul className="divide-y divide-border/60 overflow-hidden rounded-lg border">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-xs transition-colors hover:bg-muted/40"
              >
                <Badge
                  variant="outline"
                  className={`shrink-0 rounded-md font-normal ${TONES[entry.kind]}`}
                >
                  {LABELS[entry.kind]}
                </Badge>

                <span className="shrink-0 text-muted-foreground">{entry.label}</span>

                {entry.url ? (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-foreground/80 underline decoration-dotted underline-offset-4 transition-colors hover:text-foreground"
                  >
                    {truncate(entry.value)}
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="min-w-0 truncate font-mono text-muted-foreground">
                    {truncate(entry.value, 40, 8)}
                  </span>
                )}

                <span className="ml-auto shrink-0 font-mono text-muted-foreground/60">
                  {new Date(entry.at).toLocaleTimeString()}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
