"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * The rendered Arkiv query, shown verbatim. This is the evidence for two separate
 * claims — that filtering happens in the database, and that the access check does not
 * change across the expiry boundary — so it needs to be copyable, not just visible.
 */
export function QueryBlock({ query, caption }: { query: string; caption?: string }) {
  const [copied, setCopied] = useState(false);

  function copy() {
    void navigator.clipboard.writeText(query).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div className="space-y-1.5">
      {caption && <p className="text-xs text-muted-foreground">{caption}</p>}
      <div className="group relative">
        <pre className="overflow-x-auto rounded-lg border bg-muted/60 py-3 pl-3 pr-12 text-[12px] leading-relaxed text-success">
          {query}
        </pre>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={copy}
          aria-label="Copy query"
          className="absolute right-1.5 top-1.5 size-7 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
    </div>
  );
}
