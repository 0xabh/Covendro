"use client";

import { useCallback, useEffect, useState } from "react";

import { useWorkspaceRole } from "../../components/app-shell";
import { apiBase, apiFetch, pilotMode } from "../../lib/api";

type Invoice = {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  amountMinor: number;
  dueDate?: string | null;
  createdAt: string;
  vendor: { name: string; accountAddress: string };
};

function formatAmount(invoice: Invoice) {
  return `${invoice.currency} ${(invoice.amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function InvoicesPage() {
  const role = useWorkspaceRole();
  const canSubmit = !pilotMode || role === "SUBMITTER";
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  const loadInvoices = useCallback(async () => {
    setState("loading");
    try {
      const response = await apiFetch(`${apiBase}/api/invoices`);
      if (!response.ok) throw new Error("Unable to load invoices");
      const result = await response.json();
      setInvoices(result.data);
      setState("ready");
    } catch {
      setState("error");
    }
  }, []);

  useEffect(() => {
    void loadInvoices();
  }, [loadInvoices]);

  return (
    <main className="page-shell">
      <header className="page-header">
        <div>
          <p className="eyebrow">Payables</p>
          <h1>Invoices</h1>
          <p className="muted">Review incoming payment requests before they enter the treasury workflow.</p>
        </div>
        {canSubmit && <a className="button-link" href="/invoices/new">New invoice</a>}
      </header>

      <div className="page-nav"><a href="/">← Dashboard</a>{!pilotMode && <span>Demo user: submitter@covendro.local</span>}</div>

      {state === "loading" && <section className="panel-state">Loading invoices…</section>}
      {state === "error" && (
        <section className="panel-state error-state">
          <h2>Invoices could not be loaded</h2>
          <p className="muted">Check that the API is running, then retry.</p>
          <button type="button" onClick={() => void loadInvoices()}>Retry</button>
        </section>
      )}
      {state === "ready" && invoices.length === 0 && (
        <section className="panel-state">
          <div className="empty-icon">◎</div>
          <h2>No invoices yet</h2>
          {canSubmit && <a className="button-link" href="/invoices/new">Create the first invoice</a>}
        </section>
      )}
      {state === "ready" && invoices.length > 0 && (
        <section className="table-panel">
          <table>
            <thead>
              <tr><th>Invoice</th><th>Vendor</th><th>Amount</th><th>Status</th><th>Created</th><th /></tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <td><strong>{invoice.invoiceNumber}</strong><span className="table-subtext">Due {invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "not set"}</span></td>
                  <td><strong>{invoice.vendor.name}</strong><span className="table-subtext">{invoice.vendor.accountAddress}</span></td>
                  <td>{formatAmount(invoice)}</td>
                  <td><span className="status-badge">{invoice.status}</span></td>
                  <td>{new Date(invoice.createdAt).toLocaleDateString()}</td>
                  <td><a href={`/invoices/${invoice.id}`}>View →</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
