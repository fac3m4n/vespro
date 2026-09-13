"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Banknote, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { record } from "@/lib/evidence";
import {
  formatAvaxBalance,
  onWallet,
  readOwed,
  withdrawEarnings,
  type WalletState,
} from "@/lib/wallet";

/**
 * What the contract owes this seller, and the button that collects it.
 *
 * The contract pays by credit rather than by transfer on purchase, so earnings sit in
 * `owed[dataOwner]` until withdrawn. That is deliberate — a push payment to an arbitrary
 * address during `purchase` would let a hostile recipient revert and block sales — but it
 * does mean the seller needs somewhere to actually claim from.
 */
export function EarningsCard() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [owed, setOwed] = useState<bigint | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onWallet(setWallet), []);

  const refresh = useCallback(async (address: `0x${string}`) => {
    try {
      setOwed(await readOwed(address));
    } catch {
      setOwed(null);
    }
  }, []);

  useEffect(() => {
    if (!wallet?.ready || !wallet.address) return;
    const address = wallet.address;
    // refresh() awaits a contract read before it touches state, so this is not the
    // synchronous setState-in-effect the rule is guarding against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh(address);
    // Polled rather than pushed: the credit changes when a *buyer* transacts, which this
    // page has no subscription to.
    const timer = setInterval(() => void refresh(address), 15000);
    return () => clearInterval(timer);
  }, [wallet?.ready, wallet?.address, refresh]);

  if (!wallet?.ready) return null;

  async function withdraw() {
    setBusy(true);
    const progress = toast.loading("Confirm the withdrawal in your wallet");
    try {
      const hash = await withdrawEarnings();
      record("fuji-tx", "earnings withdrawn", hash);
      toast.success("Withdrawn", {
        id: progress,
        description: "The contract balance moved to your wallet.",
      });
      const address = wallet?.address;
      if (address) await refresh(address);
    } catch (error) {
      toast.error("Withdrawal failed", {
        id: progress,
        description: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  const hasEarnings = owed !== null && owed > 0n;

  return (
    <Card className={hasEarnings ? "border-success/30" : undefined}>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Banknote className="size-4 text-muted-foreground" />
              Your earnings
            </CardTitle>
            <CardDescription>
              Credited on every purchase of a listing you registered, held until you claim.
            </CardDescription>
          </div>
          <Button
            variant={hasEarnings ? "default" : "outline"}
            disabled={busy || !hasEarnings}
            onClick={() => void withdraw()}
          >
            {busy ? "Withdrawing…" : "Withdraw"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className={`font-mono text-3xl font-medium tabular-nums ${
            hasEarnings ? "text-success" : "text-muted-foreground"
          }`}
        >
          {formatAvaxBalance(owed, 8)}
        </span>
        <span className="text-sm text-muted-foreground">AVAX owed to you</span>
        <a
          href={`https://testnet.snowtrace.io/address/${wallet.address}`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 font-mono text-xs text-muted-foreground underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          {wallet.address?.slice(0, 10)}…
          <ExternalLink className="size-3" />
        </a>
      </CardContent>
    </Card>
  );
}
