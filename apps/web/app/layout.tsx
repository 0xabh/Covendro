import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Covendro",
  description: "Private payables and treasury infrastructure for programmable businesses.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
