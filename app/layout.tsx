import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Toaster } from "@/components/ui/sonner";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";

export const metadata: Metadata = {
  title: "Vespro — licence your data without giving up the rows",
  description:
    "A data marketplace where buyers train models on data they never receive. Encrypted on Swarm, indexed and licensed on Arkiv, settled on Avalanche Fuji.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`dark ${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <SiteHeader />
        <main className="mx-auto max-w-5xl px-6 py-10 md:py-14">{children}</main>
        <footer className="mx-auto max-w-5xl px-6 pb-10 text-xs text-muted-foreground">
          Built at ETHRome 2026 · testnets only, nothing here moves real money
        </footer>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
