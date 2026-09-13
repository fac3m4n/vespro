"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  connectWallet,
  formatAvaxBalance,
  onWallet,
  restoreWallet,
  switchToFuji,
  type WalletState,
} from "@/lib/wallet";

/**
 * Connect / balance / wrong-network, in the header.
 *
 * When nothing is connected the app still works — the server signs with a shared demo
 * key — so this is an upgrade rather than a gate. That distinction matters on a shared
 * machine at a hackathon, where a judge may not have a wallet at all.
 */
export function WalletButton() {
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => onWallet(setWallet), []);
  useEffect(() => {
    void restoreWallet();
  }, []);

  async function connect() {
    setBusy(true);
    try {
      await connectWallet();
      toast.success("Wallet connected", {
        description: "Listings you publish will pay out to this address.",
      });
    } catch (error) {
      toast.error("Could not connect", {
        description: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  async function fixNetwork() {
    setBusy(true);
    try {
      await switchToFuji();
    } catch (error) {
      toast.error("Could not switch network", {
        description: error instanceof Error ? error.message : "unknown error",
      });
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) return null;

  if (!wallet.available) {
    return (
      <Badge variant="secondary" className="hidden gap-1.5 font-normal sm:flex">
        <Wallet className="size-3" />
        demo wallet
      </Badge>
    );
  }

  if (!wallet.address) {
    /**
     * `optedIn` means this browser authorised the site before, so an empty account list is
     * a locked wallet rather than a first visit. Worth distinguishing: MetaMask reports no
     * accounts while locked even though the authorisation is still there, so the honest
     * message is "unlock", not "connect" — the session was never lost.
     */
    const locked = wallet.optedIn;

    return (
      <Button
        size="sm"
        variant="outline"
        disabled={busy}
        onClick={() => void connect()}
        title={
          locked
            ? "Your wallet is locked. Unlocking it restores this session — the site is still authorised."
            : undefined
        }
      >
        <Wallet />
        {busy ? "Connecting…" : locked ? "Unlock wallet" : "Connect wallet"}
      </Button>
    );
  }

  if (!wallet.ready) {
    return (
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void fixNetwork()}>
        <AlertTriangle className="text-warning" />
        Switch to Fuji
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="hidden font-mono text-sm tabular-nums sm:inline">
        {formatAvaxBalance(wallet.balanceWei)} AVAX
      </span>
      <Badge variant="secondary" className="gap-1.5 font-mono font-normal">
        <span className="size-1.5 rounded-full bg-success" />
        {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
      </Badge>
    </div>
  );
}
