"use client";

import { ChangeEvent, FormEvent, useEffect, useState } from "react";

import { useWorkspaceRole } from "../../../components/app-shell";
import { apiBase, apiFetch, pilotMode } from "../../../lib/api";

type LineItem = { description: string; quantity: string; unitAmount: string };
type InvoiceForm = {
  vendorName: string;
  vendorAddress: string;
  vendorChain: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  amount: string;
  lineItems: LineItem[];
  paymentDestination: string;
  paymentChain: string;
  memo: string;
  sourceDocument?: { fileName: string; fileType: string; content: string; encoding?: "utf8" | "base64" };
};

const blankForm: InvoiceForm = {
  vendorName: "",
  vendorAddress: "",
  vendorChain: "near",
  invoiceNumber: "",
  invoiceDate: "2026-11-01",
  dueDate: "",
  currency: "USDC",
  amount: "",
  lineItems: [{ description: "", quantity: "1", unitAmount: "" }],
  paymentDestination: "",
  paymentChain: "near",
  memo: "",
};

function formFromFixture(invoice: Partial<InvoiceForm>, sourceDocument?: InvoiceForm["sourceDocument"]): InvoiceForm {
  return {
    ...blankForm,
    ...invoice,
    vendorChain: invoice.vendorChain ?? "near",
    paymentChain: invoice.paymentChain ?? invoice.vendorChain ?? "near",
    lineItems: invoice.lineItems?.length ? invoice.lineItems : blankForm.lineItems,
    sourceDocument,
  };
}

export default function NewInvoicePage() {
  const role = useWorkspaceRole();
  const [form, setForm] = useState<InvoiceForm>(blankForm);
  const [fixtures, setFixtures] = useState<Array<{ name: string; invoice: Partial<InvoiceForm> }>>([]);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (pilotMode) return;
    apiFetch(`${apiBase}/api/invoices/fixtures`)
      .then((response) => response.json())
      .then((result) => { setFixtures(result.data ?? []); })
      .catch(() => setFixtures([]));
  }, []);

  useEffect(() => {
    if (pilotMode) return;
    const fixtureName = new URLSearchParams(window.location.search).get("fixture");
    if (!fixtureName) return;
    void loadFixture(fixtureName);
    // The scenario links intentionally load only fictional fixture JSON.
  }, []);

  function updateField(field: keyof InvoiceForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateLineItem(field: keyof LineItem, value: string) {
    setForm((current) => ({
      ...current,
      lineItems: [{ ...current.lineItems[0], [field]: value }],
    }));
  }

  async function loadFixture(name: string) {
    if (!name) return;
    const response = await apiFetch(`${apiBase}/api/invoices/fixtures/${name}`);
    const result = await response.json();
    const fixture = result.data.invoice as Partial<InvoiceForm>;
    setForm(formFromFixture(fixture, { fileName: name, fileType: "application/json", content: JSON.stringify(fixture) }));
    setMessage({ kind: "success", text: `${name} loaded. Review the extracted fields before saving.` });
  }

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
      const encoding = isPdf ? "base64" : "utf8";
      let content: string;
      if (isPdf) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (const byte of bytes) binary += String.fromCharCode(byte);
        content = btoa(binary);
      } else {
        content = await file.text();
      }

      const response = await apiFetch(`${apiBase}/api/invoices/parse-document`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fileName: file.name, fileType: file.type || (isPdf ? "application/pdf" : "text/plain"), content, encoding }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "The document could not be parsed");
      setForm(formFromFixture(result.data.fields, { fileName: file.name, fileType: file.type || (isPdf ? "application/pdf" : "text/plain"), content, encoding }));
      setMessage({ kind: "success", text: `${result.data.parser} parsed. Review the candidate fields before saving.` });
    } catch {
      setMessage({ kind: "error", text: "This document could not be parsed. Try a JSON/text file or enter the fields manually." });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const response = await apiFetch(`${apiBase}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-demo-user-email": "submitter@covendro.local" },
        body: JSON.stringify(form),
      });
      const result = await response.json();
      if (!response.ok) {
        const detail = result.error?.details?.map((item: { path: string[]; message: string }) => `${item.path.join(".")}: ${item.message}`).join("; ");
        throw new Error(detail || result.error?.message || "Invoice could not be saved");
      }
      window.location.href = `/invoices/${result.data.id}`;
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "Invoice could not be saved" });
    } finally {
      setSubmitting(false);
    }
  }

  if (pilotMode && role !== "SUBMITTER") {
    return <main className="page-shell narrow-page"><section className="panel">
      <h1>New invoice</h1><p>Ask a workspace submitter to create the invoice.</p><a href="/invoices">View invoices</a>
    </section></main>;
  }

  return (
    <main className="page-shell narrow-page">
      <header className="page-header">
        <div><p className="eyebrow">New payable</p><h1>Upload an invoice</h1><p className="muted">{pilotMode ? "Upload a text PDF, JSON or text file, or enter the invoice manually." : "JSON fixtures and manual entry are supported. Original document content is hashed and discarded after processing."}</p></div>
      </header>
      <div className="page-nav"><a href="/invoices">← Invoices</a>{!pilotMode && <span>Demo mode · Submitter</span>}</div>

      {message && <div className={message.kind === "error" ? "form-message error-state" : "form-message success-state"}>{message.text}</div>}

      <section className="panel upload-tools">
        {!pilotMode && <div><strong>Start from a fictional fixture</strong><p className="muted">Fixtures are safe demo data and never represent a real person or company.</p></div>}
        <div className="tool-row">
          {!pilotMode && <select aria-label="Sample invoice" defaultValue="" onChange={(event) => void loadFixture(event.target.value)}>
            <option value="">Choose a sample invoice…</option>
            {fixtures.map((fixture) => <option key={fixture.name} value={fixture.name}>{fixture.name}</option>)}
          </select>}
          <label className="file-button">Upload document<input type="file" accept="application/json,text/plain,application/pdf,.json,.txt,.pdf" onChange={(event) => void handleFile(event)} /></label>
        </div>
      </section>

      <form className="panel invoice-form" onSubmit={handleSubmit}>
        <div className="form-section"><p className="eyebrow">Vendor</p><div className="form-grid">
          <label>Vendor name<input required value={form.vendorName} onChange={(event) => updateField("vendorName", event.target.value)} placeholder="Northstar Design Co." /></label>
          <label>Vendor account<input required value={form.vendorAddress} onChange={(event) => updateField("vendorAddress", event.target.value)} placeholder="northstar.near or 0x…" /></label>
          <label>Vendor chain<select value={form.vendorChain} onChange={(event) => updateField("vendorChain", event.target.value)}><option value="near">NEAR</option><option value="ethereum">Ethereum</option><option value="base">Base</option></select></label>
        </div></div>
        <div className="form-section"><p className="eyebrow">Invoice details</p><div className="form-grid">
          <label>Invoice number<input required value={form.invoiceNumber} onChange={(event) => updateField("invoiceNumber", event.target.value)} placeholder="NS-2026-001" /></label>
          <label>Invoice date<input required type="date" value={form.invoiceDate} onChange={(event) => updateField("invoiceDate", event.target.value)} /></label>
          <label>Due date<input type="date" value={form.dueDate} onChange={(event) => updateField("dueDate", event.target.value)} /></label>
          <label>Currency<select value={form.currency} onChange={(event) => updateField("currency", event.target.value)}><option value="USDC">USDC</option><option value="USDT">USDT</option></select></label>
          <label>Amount<input required inputMode="decimal" value={form.amount} onChange={(event) => updateField("amount", event.target.value)} placeholder="1250.00" /></label>
        </div></div>
        <div className="form-section"><p className="eyebrow">Line item</p><div className="form-grid line-grid">
          <label>Description<input required value={form.lineItems[0].description} onChange={(event) => updateLineItem("description", event.target.value)} placeholder="Design work" /></label>
          <label>Quantity<input required inputMode="decimal" value={form.lineItems[0].quantity} onChange={(event) => updateLineItem("quantity", event.target.value)} /></label>
          <label>Unit amount<input required inputMode="decimal" value={form.lineItems[0].unitAmount} onChange={(event) => updateLineItem("unitAmount", event.target.value)} /></label>
        </div></div>
        <div className="form-section"><p className="eyebrow">Settlement destination</p><div className="form-grid">
          <label>Payment destination<input required value={form.paymentDestination} onChange={(event) => updateField("paymentDestination", event.target.value)} placeholder="northstar.near or 0x…" /></label>
          <label>Payment chain<select value={form.paymentChain} onChange={(event) => updateField("paymentChain", event.target.value)}><option value="near">NEAR</option><option value="ethereum">Ethereum</option><option value="base">Base</option></select></label>
          <label className="wide-field">Memo<textarea value={form.memo} onChange={(event) => updateField("memo", event.target.value)} placeholder="Optional payment memo" /></label>
        </div></div>
        <div className="form-actions"><a href="/invoices">Cancel</a><button type="submit" disabled={submitting}>{submitting ? "Saving…" : "Save invoice draft"}</button></div>
      </form>
    </main>
  );
}
