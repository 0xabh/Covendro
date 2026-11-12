"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Payment = { id: string; status: string; quoteMode?: string | null; rail: string; quoteId?: string | null; amountMinor: number; createdAt: string; invoice: { invoiceNumber: string; currency: string; vendor: { name: string } } };

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(() => { setState("loading"); fetch(`${apiBase}/api/payments`).then(async (response) => { if (!response.ok) throw new Error(); return response.json(); }).then((result) => { setPayments(result.data); setState("ready"); }).catch(() => setState("error")); }, []);
  useEffect(() => { void load(); }, [load]);

  return <main className="page-shell"><header className="page-header"><div><p className="eyebrow">Settlement</p><h1>Payments</h1><p className="muted">Quotes and simulated outcomes. A mock result is never an on-chain transaction.</p></div></header><div className="page-nav"><a href="/">← Dashboard</a><span>Real dry quotes remain non-executing</span></div>
    {state === "loading" && <section className="panel-state">Loading payments…</section>}
    {state === "error" && <section className="panel-state error-state"><h2>Payments could not be loaded</h2><button onClick={() => void load()}>Retry</button></section>}
    {state === "ready" && payments.length === 0 && <section className="panel-state"><div className="empty-icon">◎</div><h2>No payment quotes yet</h2><p className="muted">Approve an invoice before requesting a quote.</p><a className="button-link" href="/invoices">Review invoices</a></section>}
    {state === "ready" && payments.length > 0 && <section className="table-panel"><table><thead><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Mode</th><th>Status</th><th /></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td><strong>{payment.invoice.invoiceNumber}</strong><span className="table-subtext">{payment.quoteId ?? "Quote pending"}</span></td><td>{payment.invoice.vendor.name}</td><td>{payment.invoice.currency} {(payment.amountMinor / 100).toFixed(2)}</td><td><span className={`status-badge ${payment.quoteMode === "REAL_DRY" ? "warning-badge" : ""}`}>{payment.quoteMode ?? "REQUESTED"}</span></td><td><span className="status-badge">{payment.status}</span></td><td><a href={`/payments/${payment.id}`}>View →</a></td></tr>)}</tbody></table></section>}
  </main>;
}
