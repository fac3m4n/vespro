import type { Metadata } from "next";
import Link from "next/link";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vespro — licence your data without giving up the rows",
  description:
    "A data marketplace where buyers train models on data they never receive. Encrypted on Swarm, indexed and licensed on Arkiv, settled on Avalanche Fuji.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3.5">
            <Link href="/" className="font-semibold tracking-tight">
              Vespro
            </Link>
            <nav className="flex gap-4 text-sm text-muted-foreground">
              <Link href="/" className="transition-colors hover:text-foreground">
                Marketplace
              </Link>
              <Link href="/sell" className="transition-colors hover:text-foreground">
                Sell data
              </Link>
            </nav>
            <p className="ml-auto hidden text-xs text-muted-foreground sm:block">
              Swarm holds the bytes · Arkiv holds the licence · Fuji settles
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
