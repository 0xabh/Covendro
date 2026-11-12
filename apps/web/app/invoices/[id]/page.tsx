"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { VerificationPanel } from "../../../components/verification-panel";

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
  extractedAt?: string | null;
  extractionProvider?: string | null;
  extractionModel?: string | null;
  extractionConfidence?: number | null;
  extractionRequestId?: string | null;
  analysisCompletedAt?: string | null;
  verificationState?: "MOCKED" | "UNVERIFIED" | "VERIFIED" | "VERIFICATION_FAILED" | null;
  verificationExplanation?: string | null;
  anomalyResultJson?: string | null;
  vendorRiskDecision?: string | null;
  vendorRiskReasonsJson?: string | null;
  policyDecision?: string | null;
  policyReasonsJson?: string | null;
  requiredApprovals?: number | null;
  policyVersion?: number | null;
  approvalRound?: number;
  payment?: { id: string; status: string; quoteMode?: string | null } | null;
  createdAt: string;
  vendor: { name: string; accountAddress: string; accountChain?: string | null };
  lineItems: Array<{ id: string; description: string; quantity: number; totalAmountMinor: number }>;
  auditEvents: Array<{ id: string; eventType: string; description: string; createdAt: string }>;
  approvals: Array<{ id: string; decision: string; reason?: string | null; createdAt: string; approvalRound: number; reviewer: { name: string; email: string } }>;
};

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const [invoice, setInvoice] = useState<InvoiceDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [analysisState, setAnalysisState] = useState<"idle" | "working" | "error">("idle");
  const [analysisError, setAnalysisError] = useState("");
  const [workflowState, setWorkflowState] = useState<"idle" | "working" | "error">("idle");
  const [workflowMessage, setWorkflowMessage] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [quoteState, setQuoteState] = useState<"idle" | "working">("idle");

  const anomalies = invoice?.anomalyResultJson ? (() => {
    try { return JSON.parse(invoice.anomalyResultJson) as { anomalies?: Array<{ code: string; severity: string; message: string }> }; } catch { return { anomalies: [] }; }
  })() : { anomalies: [] };
  const vendorRisk = invoice?.vendorRiskReasonsJson ? (() => { try { return JSON.parse(invoice.vendorRiskReasonsJson) as { reasons?: string[]; riskScore?: number }; } catch { return { reasons: [] }; } })() : { reasons: [] };
  const policyReview = invoice?.policyReasonsJson ? (() => { try { return JSON.parse(invoice.policyReasonsJson) as { reasons?: string[] }; } catch { return { reasons: [] }; } })() : { reasons: [] };
  const controlDecision = invoice?.vendorRiskDecision === "BLOCK" || invoice?.policyDecision === "BLOCK" ? "BLOCK" : invoice?.vendorRiskDecision === "WARN" || invoice?.policyDecision === "WARN" ? "WARN" : invoice?.vendorRiskDecision && invoice?.policyDecision ? "ALLOW" : "PENDING";
  const controlReasons = [...(vendorRisk.reasons ?? []), ...(policyReview.reasons ?? [])];

  async function runAnalysis() {
    if (!invoice) return;
    setAnalysisState("working");
    setAnalysisError("");
    try {
      const response = await fetch(`${apiBase}/api/invoices/${invoice.id}/analyze`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Analysis failed");
      setInvoice(result.data.invoice);
      setAnalysisState("idle");
    } catch (error) {
      setAnalysisError(error instanceof Error ? error.message : "Analysis failed");
      setAnalysisState("error");
    }
  }

  async function workflowAction(action: "submit" | "resubmit" | "approve" | "reject") {
    if (!invoice) return;
    setWorkflowState("working"); setWorkflowMessage("");
    const isReviewerAction = action === "approve" || action === "reject";
    try {
      const response = await fetch(`${apiBase}/api/invoices/${invoice.id}/${action}`, {
        method: "POST",
        headers: {
          ...(action === "reject" ? { "content-type": "application/json" } : {}),
          "x-demo-user-email": isReviewerAction ? "reviewer@covendro.local" : "submitter@covendro.local",
          ...(isReviewerAction ? { "idempotency-key": `ui-${action}-${invoice.id}-${invoice.approvalRound ?? 1}` } : {}),
        },
        body: action === "reject" ? JSON.stringify({ reason: rejectionReason }) : undefined,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Workflow action failed");
      setInvoice(result.data.invoice);
      const actionLabel = action === "submit" ? "submitted" : action === "resubmit" ? "resubmitted" : action === "approve" ? "approved" : "rejected";
      setWorkflowMessage(result.data.idempotent ? "No duplicate action was recorded." : `Invoice ${actionLabel} successfully.`);
      setWorkflowState("idle");
    } catch (error) { setWorkflowMessage(error instanceof Error ? error.message : "Workflow action failed"); setWorkflowState("error"); }
  }

  async function createQuote() {
    if (!invoice) return;
    setQuoteState("working"); setWorkflowMessage("");
    try {
      const response = await fetch(`${apiBase}/api/invoices/${invoice.id}/quote`, { method: "POST", headers: { "x-demo-user-email": "reviewer@covendro.local", "idempotency-key": `ui-quote-${invoice.id}` } });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Quote could not be created");
      window.location.href = `/payments/${result.data.payment.id}`;
    } catch (error) { setWorkflowMessage(error instanceof Error ? error.message : "Quote could not be created"); }
    finally { setQuoteState("idle"); }
  }

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
      <div className="page-nav"><a href="/invoices">← Invoices</a><button className="secondary-button" onClick={runAnalysis} disabled={analysisState === "working"}>{analysisState === "working" ? "Analyzing…" : invoice.extractedAt ? "Run analysis again" : "Analyze invoice"}</button></div>
      {analysisError && <div className="form-message error-state">{analysisError} <button className="secondary-button" onClick={runAnalysis}>Retry</button></div>}
      {workflowMessage && <div className={`form-message ${workflowState === "error" ? "error-state" : "success-state"}`}>{workflowMessage}</div>}
      <section className="panel workflow-actions"><div><p className="eyebrow">Approval workflow</p><h2>Next action</h2><p className="muted">Demo actions use the seeded submitter and reviewer identities. Each transition is recorded in the audit history.</p></div><div className="action-row">{(invoice.status === "DRAFT" || invoice.status === "EXTRACTED") && <button onClick={() => void workflowAction("submit")} disabled={workflowState === "working"}>Submit for review</button>}{invoice.status === "REJECTED" && <button onClick={() => void workflowAction("resubmit")} disabled={workflowState === "working"}>Resubmit for review</button>}{invoice.status === "REVIEW_REQUIRED" && invoice.policyDecision !== "BLOCK" && invoice.vendorRiskDecision !== "BLOCK" && <><button onClick={() => void workflowAction("approve")} disabled={workflowState === "working"}>Approve as reviewer</button><input className="reject-input" value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} placeholder="Reason if rejecting" /><button className="secondary-button" onClick={() => void workflowAction("reject")} disabled={workflowState === "working" || rejectionReason.trim().length < 3}>Reject</button></>}{invoice.status === "APPROVED" && <button onClick={() => void createQuote()} disabled={quoteState === "working"}>{quoteState === "working" ? "Requesting quote…" : "Generate payment quote"}</button>}{invoice.status === "QUOTE_READY" && invoice.payment && <a className="button-link" href={`/payments/${invoice.payment.id}`}>View payment quote</a>}{invoice.status === "BLOCKED" && <span className="status-badge danger-badge">Approval unavailable: blocked</span>}</div></section>
      <section className="detail-grid">
        <article className="panel"><p className="eyebrow">Vendor</p><h2>{invoice.vendor.name}</h2><p className="muted">{invoice.vendor.accountAddress} · {invoice.vendor.accountChain ?? "chain not set"}</p><dl className="detail-list"><dt>Invoice date</dt><dd>{new Date(invoice.invoiceDate).toLocaleDateString()}</dd><dt>Due date</dt><dd>{invoice.dueDate ? new Date(invoice.dueDate).toLocaleDateString() : "Not set"}</dd><dt>Amount</dt><dd>{invoice.currency} {(invoice.amountMinor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}</dd><dt>Destination</dt><dd>{invoice.paymentDestination} · {invoice.paymentChain ?? "chain not set"}</dd></dl></article>
        <article className="panel"><p className="eyebrow">Line items</p><div className="line-item-list">{invoice.lineItems.map((item) => <div className="line-item" key={item.id}><span>{item.description} × {item.quantity}</span><strong>{invoice.currency} {(item.totalAmountMinor / 100).toFixed(2)}</strong></div>)}</div>{invoice.memo && <p className="muted memo">{invoice.memo}</p>}</article>
      </section>
      <section className="panel"><p className="eyebrow">Document metadata</p><p className="muted">The original document is not retained. Only processing metadata is persisted.</p><dl className="detail-list compact-list"><dt>File type</dt><dd>{invoice.fileType ?? "Manual entry"}</dd><dt>SHA-256</dt><dd className="hash-value">{invoice.fileHash ?? "Not applicable"}</dd></dl></section>
      <section className="detail-grid">
        <VerificationPanel state={invoice.verificationState} provider={invoice.extractionProvider} model={invoice.extractionModel} timestamp={invoice.analysisCompletedAt ?? invoice.extractedAt} explanation={invoice.verificationExplanation} />
        <article className="panel"><p className="eyebrow">Anomaly review</p><h2>{anomalies.anomalies?.length ?? 0} signal{anomalies.anomalies?.length === 1 ? "" : "s"}</h2>{anomalies.anomalies?.length ? <div className="anomaly-list">{anomalies.anomalies.map((anomaly) => <div className={`anomaly-row anomaly-${anomaly.severity.toLowerCase()}`} key={`${anomaly.code}-${anomaly.message}`}><span className="status-badge">{anomaly.severity}</span><div><strong>{anomaly.code.replaceAll("_", " ")}</strong><p className="muted">{anomaly.message}</p></div></div>)}</div> : <p className="muted">Run analysis to check for missing information, duplicate documents, recipient history, and unusual amounts.</p>}</article>
      </section>
      <section className="detail-grid"><article className="panel"><p className="eyebrow">Vendor risk</p><div className="decision-heading"><h2>{invoice.vendorRiskDecision ?? "NOT ASSESSED"}</h2>{vendorRisk.riskScore !== undefined && <span className="muted">Score {vendorRisk.riskScore}/100</span>}</div><div className="reason-list">{vendorRisk.reasons?.map((reason) => <p key={reason}>• {reason}</p>) ?? <p className="muted">Run analysis to assess the recipient.</p>}</div></article><article className="panel"><p className="eyebrow">Treasury policy</p><div className="decision-heading"><h2>{invoice.policyDecision ?? "NOT EVALUATED"}</h2>{invoice.policyVersion && <span className="muted">Policy v{invoice.policyVersion}</span>}</div><div className="reason-list">{policyReview.reasons?.map((reason) => <p key={reason}>• {reason}</p>) ?? <p className="muted">Run analysis to evaluate the active policy.</p>}</div>{invoice.requiredApprovals !== null && invoice.requiredApprovals !== undefined && <p className="muted">Required approvals: {invoice.requiredApprovals}</p>}</article></section>
      <section className="panel decision-summary"><span className="decision-symbol" aria-hidden="true">{controlDecision === "BLOCK" ? "!" : controlDecision === "WARN" ? "~" : controlDecision === "ALLOW" ? "✓" : "…"}</span><div><p className="eyebrow">Decision explanation</p><h2>{controlDecision === "PENDING" ? "Run analysis to produce a deterministic decision" : `${controlDecision}: ${controlDecision === "ALLOW" ? "eligible for the configured workflow" : controlDecision === "WARN" ? "manual review required" : "approval is blocked"}`}</h2><p className="muted">AI extraction supplies evidence; vendor risk and treasury policy make the payment decision. {controlReasons.length ? `${controlReasons.length} reason${controlReasons.length === 1 ? "" : "s"} recorded below.` : "No control reasons have been recorded yet."}</p></div></section>
      {invoice.extractionConfidence !== null && invoice.extractionConfidence !== undefined && <p className="muted analysis-footnote">Extraction confidence: {(invoice.extractionConfidence * 100).toFixed(0)}% · Request ID: {invoice.extractionRequestId ?? "not supplied"}</p>}
      <section className="panel"><p className="eyebrow">Evidence timeline</p><h2>Every decision, in order</h2><div className="timeline">{invoice.auditEvents.map((event) => <div className="timeline-row" key={event.id}><span className="status-dot" /><div><strong>{event.eventType.replaceAll("_", " ")}</strong><p className="muted">{event.description}</p></div><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}</div></section>
      <section className="panel"><p className="eyebrow">Approval records</p>{invoice.approvals.length === 0 ? <p className="muted">No reviewer decision has been recorded.</p> : <div className="approval-list">{invoice.approvals.map((approval) => <div className="approval-row" key={approval.id}><span className={`status-badge ${approval.decision === "REJECTED" ? "danger-badge" : ""}`}>{approval.decision}</span><div><strong>{approval.reviewer.name}</strong><p className="muted">{approval.reason ?? "No reason supplied"} · round {approval.approvalRound}</p></div><time>{new Date(approval.createdAt).toLocaleString()}</time></div>)}</div>}</section>
    </main>
  );
}
