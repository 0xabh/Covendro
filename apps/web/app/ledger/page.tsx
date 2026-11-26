"use client";

import { useCallback, useEffect, useState } from "react";

import { apiBase, apiFetch } from "../../lib/api";
type Ledger = { invoiceId: string; invoiceNumber: string; vendor: string; grossAmountMinor: number; currency: string; paymentStatus: string; paymentRail?: string | null; quoteMode?: string | null; quoteId?: string | null; transactionHash?: string | null; refundStatus?: string | null; createdAt: string; approvedAt?: string | null; paidAt?: string | null };

export default function LedgerPage() {
  const [entries, setEntries] = useState<Ledger[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(() => { setState("loading"); apiFetch(`${apiBase}/api/ledger`).then(async (response) => { if (!response.ok) throw new Error(); return response.json(); }).then((result) => { setEntries(result.data); setState("ready"); }).catch(() => setState("error")); }, []);
  useEffect(() => { void load(); }, [load]);

  return <main className="page-shell"><header className="page-header"><div><p className="eyebrow">Bookkeeping</p><h1>Ledger</h1><p className="muted">A payment projection with quote, approval, settlement, and refund references.</p></div><a className="button-link" href={`${apiBase}/api/ledger.csv`}>Export CSV</a></header><div className="page-nav"><a href="/">← Dashboard</a><span>CSV is generated from the local ledger projection</span></div>
    {state === "loading" && <section className="panel-state">Loading ledger…</section>}
    {state === "error" && <section className="panel-state error-state"><h2>Ledger could not be loaded</h2><button onClick={() => void load()}>Retry</button></section>}
    {state === "ready" && entries.length === 0 && <section className="panel-state"><div className="empty-icon">◎</div><h2>No ledger entries yet</h2><p className="muted">Ledger entries appear when an approved invoice receives a quote.</p></section>}
    {state === "ready" && entries.length > 0 && <section className="table-panel"><table><thead><tr><th>Invoice</th><th>Vendor</th><th>Gross amount</th><th>Status</th><th>Rail</th><th>Quote / transaction</th><th>Paid</th></tr></thead><tbody>{entries.map((entry) => <tr key={entry.invoiceId}><td><strong>{entry.invoiceNumber}</strong></td><td>{entry.vendor}</td><td>{entry.currency} {(entry.grossAmountMinor / 100).toFixed(2)}</td><td><span className="status-badge">{entry.paymentStatus}</span>{entry.refundStatus && <span className="table-subtext">{entry.refundStatus}</span>}</td><td>{entry.paymentRail ?? "—"}<span className="table-subtext">{entry.quoteMode ?? "—"}</span></td><td><span className="table-subtext">Quote: {entry.quoteId ?? "—"}</span><span className="table-subtext">Tx: {entry.transactionHash ?? "—"}</span></td><td>{entry.paidAt ? new Date(entry.paidAt).toLocaleString() : "—"}</td></tr>)}</tbody></table></section>}
  </main>;
}
