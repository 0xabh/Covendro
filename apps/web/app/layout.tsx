import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "../components/app-shell";

export const metadata: Metadata = {
  title: "Covendro",
  description:
    "Covendro is a private accounts-payable and treasury safety system for crypto-native organizations.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <div
          className="truth-banner"
          role="status"
          aria-label="Covendro integration truth panel"
        >
          <div className="truth-banner-track">
            <span>This invoice is fictional.</span>
            <i>•</i>
            <span>The NEAR AI request is real.</span>
            <i>•</i>
            <span>The policy decision is deterministic.</span>
            <i>•</i>
            <span>The NEAR Intents quote is real and dry.</span>
            <i>•</i>
            <span>No funds can move without explicit approval.</span>
            <i>•</i>
            <span>Every decision is auditable.</span>
            <span aria-hidden="true">This invoice is fictional.</span>
            <i aria-hidden="true">•</i>
            <span aria-hidden="true">The NEAR AI request is real.</span>
            <i aria-hidden="true">•</i>
            <span aria-hidden="true">
              The policy decision is deterministic.
            </span>
            <i aria-hidden="true">•</i>
            <span aria-hidden="true">
              The NEAR Intents quote is real and dry.
            </span>
            <i aria-hidden="true">•</i>
            <span aria-hidden="true">
              No funds can move without explicit approval.
            </span>
            <i aria-hidden="true">•</i>
            <span aria-hidden="true">Every decision is auditable.</span>
          </div>
        </div>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
