"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { clearEvidence, onEvidence, truncate, type Evidence, type EvidenceKind } from "@/lib/evidence";

const LABELS: Record<EvidenceKind, string> = {
  "arkiv-entity": "Arkiv entity",
  "arkiv-tx": "Arkiv tx",
  "arkiv-query": "Query",
  "fuji-tx": "Fuji tx",
  "swarm-ref": "Swarm",
  local: "Local",
};

const TONES: Record<EvidenceKind, string> = {
  "arkiv-entity": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "arkiv-tx": "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  "arkiv-query": "bg-sky-500/10 text-sky-400 border-sky-500/20",
  "fuji-tx": "bg-red-500/10 text-red-400 border-red-500/20",
  "swarm-ref": "bg-orange-500/10 text-orange-400 border-orange-500/20",
  local: "bg-muted text-muted-foreground",
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
          <div>
            <CardTitle className="text-sm">Evidence</CardTitle>
            <CardDescription className="text-xs">
              Every transaction, entity and query this session produced.
            </CardDescription>
          </div>
          {entries.length > 0 && (
            <Button variant="ghost" size="sm" onClick={clearEvidence}>
              <Trash2 className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            Nothing yet. Publish a dataset or buy a licence.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-2 text-xs">
                <Badge
                  variant="outline"
                  className={`shrink-0 border text-[10px] ${TONES[entry.kind]}`}
                >
                  {LABELS[entry.kind]}
                </Badge>
                <span className="shrink-0 text-muted-foreground">{entry.label}</span>
                {entry.url ? (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-foreground/80 underline decoration-dotted hover:text-foreground"
                  >
                    {truncate(entry.value)}
                    <ExternalLink className="size-3 shrink-0" />
                  </a>
                ) : (
                  <span className="min-w-0 truncate font-mono text-foreground/60">
                    {truncate(entry.value, 40, 8)}
                  </span>
                )}
                <span className="ml-auto shrink-0 text-muted-foreground/60">
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
