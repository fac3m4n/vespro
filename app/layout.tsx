import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vespro — licence your data without giving up the rows",
  description:
    "A data marketplace where buyers train models on data they never receive. Encrypted on Swarm, indexed and licensed on Arkiv, settled on Avalanche Fuji.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-950 text-neutral-100 antialiased">
        <header className="border-b border-neutral-800">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-4">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Vespro
            </Link>
            <nav className="flex gap-4 text-sm text-neutral-400">
              <Link href="/" className="hover:text-neutral-100">
                Marketplace
              </Link>
              <Link href="/sell" className="hover:text-neutral-100">
                Sell data
              </Link>
            </nav>
            <p className="ml-auto hidden text-xs text-neutral-500 sm:block">
              Swarm holds the bytes · Arkiv holds the licence · Fuji settles
            </p>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
