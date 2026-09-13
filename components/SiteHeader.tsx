"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { WalletButton } from "@/components/WalletButton";

const NAV = [
  { href: "/", label: "Marketplace" },
  { href: "/sell", label: "Sell data" },
];

export function SiteHeader() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-5xl items-center gap-8 px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-6 place-items-center rounded-md bg-foreground text-[11px] font-bold text-background">
            V
          </span>
          Vespro
        </Link>

        <nav className="flex items-center gap-1 text-sm">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "rounded-md px-2.5 py-1.5 transition-colors",
                  active
                    ? "bg-accent font-medium text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <p className="ml-auto hidden text-xs text-muted-foreground xl:block">
          Swarm holds the bytes · Arkiv holds the licence · Fuji settles
        </p>

        <div className="ml-auto xl:ml-0">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
