"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type InvoiceDetail = {
  id: string;
  invoiceNumber: string;
  status: string;
  currency: string;
  amountMinor: number;
  invoiceDate: string;
  dueDate?: string | null;
  paymentDestination: string;
  paymentChain?: string | null;
  memo?: string | null;
  fileHash?: string | null;
  fileType?: string | null;
  createdAt: string;
  vendor: { name: string; accountAddress: string; accountChain?: string | null };
  lineItems: Array<{ id: string; description: string; quantity: number; totalAmountMinor: number }>;
  auditEvents: Array<{ id: string; eventType: string; description: string; createdAt: string }>;
};

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    if (!params.id) return;
    fetch(`${apiBase}/api/invoices/${params.id}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("Invoice not found");
        return response.json();
      })
      .then((result) => { setInvoice(result.data); setState("ready"); })
      .catch(() => setState("error"));
  }, [params.id]);

  if (state === "loading") return <main className="page-shell"><section className="panel-state">Loading invoice…</section></main>;
  if (state === "error" || !invoice) return <main className="page-shell"><section className="panel-state error-state"><h2>Invoice not found</h2><a href="/invoices">Return to invoices</a></section></main>;

  return (
    <main className="page-shell narrow-page">
      <header className="page-header">
        <div><p className="eyebrow">Invoice detail</p><h1>{invoice.invoiceNumber}</h1><p className="muted">Created {new Date(invoice.createdAt).toLocaleString()}</p></div>
        <span className="status-badge large-badge">{invoice.status}</span>
      </header>
      <div className="page-nav"><a href="/invoices">← Invoices</a><span>Verification and approval will follow in later milestones.</span></div>
      <section className="detail-grid">
        <article className="panel"><p className="eyebrow">Vendor</p><h2>{invoice.vendor.name}</h2><p className="muted">{invoice.vendor.accountAddress} · {invoice.vendor.accountChain ?? "chain not set"}</p><dl className="detail-list"><dt>Invoice date</dt><dd>{new Date(invoice.invoiceDate).toLocaleDateString()}</dd><dt>Due date</dt><dd>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "Not set"}</dd><dt>Amount</dt><dd>{invoice.currency} {(invoice.amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd><dt>Destination</dt><dd>{invoice.paymentDestination} · {invoice.paymentChain ?? "chain not set"}</dd></dl></article>
        <article className="panel"><p className="eyebrow">Line items</p><div className="line-item-list">{invoice.lineItems.map((item) => <div className="line-item" key={item.id}><span>{item.description} × {item.quantity}</span><strong>{invoice.currency} {(item.totalAmountMinor / 100).toFixed(2)}</strong></div>)}</div>{invoice.memo && <p className="muted memo">{invoice.memo}</p>}</article>
      </section>
      <section className="panel"><p className="eyebrow">Document metadata</p><p className="muted">The original document is not retained. Only processing metadata is persisted.</p><dl className="detail-list compact-list"><dt>File type</dt><dd>{invoice.fileType ?? "Manual entry"}</dd><dt>SHA-256</dt><dd className="hash-value">{invoice.fileHash ?? "Not applicable"}</dd></dl></section>
      <section className="panel"><p className="eyebrow">Audit history</p><div className="audit-list">{invoice.auditEvents.map((event) => <div className="audit-row" key={event.id}><span className="status-dot" /><div><strong>{event.eventType}</strong><p className="muted">{event.description}</p></div><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}</div></section>
    </main>
  );
}
