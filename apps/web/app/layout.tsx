import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Covendro",
  description: "Covendro is a private accounts-payable and treasury safety system for crypto-native organizations.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
