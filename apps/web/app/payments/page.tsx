"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspaceRole } from "../../components/app-shell";
import { apiBase, apiFetch, pilotMode } from "../../lib/api";
type Payment = { id: string; status: string; quoteMode?: string | null; rail: string; quoteId?: string | null; amountMinor: number; createdAt: string; invoice: { invoiceNumber: string; currency: string; vendor: { name: string } } };

export default function PaymentsPage() {
  const role = useWorkspaceRole();
  const [openAttempts, setOpenAttempts] = useState<Array<{ id: string; invoiceNumber: string; paymentId?: string; status: string; reconcileIssue?: string; nextCheckAt?: string }>>([]);
  useEffect(() => {
    if (!pilotMode || !["TREASURY_ADMINISTRATOR", "TREASURY_SIGNER", "AUDITOR"].includes(role ?? "")) return;
    apiFetch(`${apiBase}/api/payments/reconciliation`)
      .then(async (response) => { if (response.ok) setOpenAttempts((await response.json()).data); })
      .catch(() => undefined);
  }, [role]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(() => { setState("loading"); apiFetch(`${apiBase}/api/payments`).then(async (response) => { if (!response.ok) throw new Error(); return response.json(); }).then((result) => { setPayments(result.data); setState("ready"); }).catch(() => setState("error")); }, []);
  useEffect(() => { void load(); }, [load]);

  return <main className="page-shell"><header className="page-header"><div><p className="eyebrow">Settlement</p><h1>Payments</h1><p className="muted">{pilotMode ? "Payment quotes and treasury funding status." : "Quotes and simulated outcomes. A mock result is never an on-chain transaction."}</p></div></header><div className="page-nav"><a href="/">← Dashboard</a>{!pilotMode && <span>Real dry quotes remain non-executing</span>}</div>
    {openAttempts.length > 0 && <section className="panel">
      <h2>Reconciliation queue</h2>
      <ul>{openAttempts.map((attempt) => <li key={attempt.id}>
        {attempt.paymentId ? <a href={`/payments/${attempt.paymentId}`}>{attempt.invoiceNumber}</a> : attempt.invoiceNumber}
        {" · "}{(attempt.reconcileIssue ?? attempt.status).replaceAll("_", " ")}
        {attempt.nextCheckAt && <> · Next check {new Date(attempt.nextCheckAt).toLocaleString()}</>}
      </li>)}</ul>
    </section>}
    {state === "loading" && <section className="panel-state">Loading payments…</section>}
    {state === "error" && <section className="panel-state error-state"><h2>Payments could not be loaded</h2><button onClick={() => void load()}>Retry</button></section>}
    {state === "ready" && payments.length === 0 && <section className="panel-state"><div className="empty-icon">◎</div><h2>No payment quotes yet</h2><p className="muted">Approve an invoice before requesting a quote.</p><a className="button-link" href="/invoices">Review invoices</a></section>}
    {state === "ready" && payments.length > 0 && <section className="table-panel"><table><thead><tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Mode</th><th>Status</th><th /></tr></thead><tbody>{payments.map((payment) => <tr key={payment.id}><td><strong>{payment.invoice.invoiceNumber}</strong><span className="table-subtext">{payment.quoteId ?? "Quote pending"}</span></td><td>{payment.invoice.vendor.name}</td><td>{payment.invoice.currency} {(payment.amountMinor / 100).toFixed(2)}</td><td><span className={`status-badge ${payment.quoteMode === "REAL_DRY" ? "warning-badge" : ""}`}>{payment.quoteMode === "LIVE_HANDOFF" ? "MAINNET" : payment.quoteMode ?? "REQUESTED"}</span></td><td><span className="status-badge">{payment.status}</span></td><td><a href={`/payments/${payment.id}`}>View →</a></td></tr>)}</tbody></table></section>}
  </main>;
}
