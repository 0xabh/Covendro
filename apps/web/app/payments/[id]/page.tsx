"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { apiBase, apiFetch } from "../../../lib/api";
type Payment = { liveEvidence?: { destinationTxHash?: string; refundTxHash?: string; originDebitAtomic: string; destinationAmountAtomic: string; refundedAtomic?: string; reconcileIssue?: string }; id: string; status: string; quoteMode?: string | null; rail: string; quoteId?: string | null; providerStatus?: string | null; sourceAsset?: string | null; destinationAsset?: string | null; sourceChain?: string | null; destinationChain?: string | null; amountMinor: number; estimatedReceivedMinor?: number | null; slippageBps?: number | null; quoteExpiresAt?: string | null; refundDestination?: string | null; depositAddress?: string | null; depositMemo?: string | null; depositRequirementsJson?: string | null; transactionHash?: string | null; refundStatus?: string | null; invoice: { id: string; invoiceNumber: string; status: string; currency: string; vendor: { name: string } } };

export default function PaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const [payment, setPayment] = useState<Payment | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [working, setWorking] = useState(false);

  function load() { if (!params.id) return; setState("loading"); apiFetch(`${apiBase}/api/payments/${params.id}`).then(async (response) => { if (!response.ok) throw new Error(); return response.json(); }).then((result) => { setPayment(result.data); setState("ready"); }).catch(() => setState("error")); }
  useEffect(load, [params.id]);

  async function simulate(outcome: "SUCCESS" | "REFUNDED" | "FAILED" | "EXPIRED") {
    if (!payment) return;
    setWorking(true); setMessage("");
    try {
      const response = await apiFetch(`${apiBase}/api/payments/${payment.id}/simulate`, { method: "POST", headers: { "content-type": "application/json", "x-demo-user-email": "reviewer@covendro.local" }, body: JSON.stringify({ outcome }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Simulation failed");
      setPayment(result.data.payment); setMessage(`Simulation finished with ${outcome}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Simulation failed"); }
    finally { setWorking(false); }
  }

  if (state === "loading") return <main className="page-shell narrow-page"><section className="panel-state">Loading payment…</section></main>;
  if (state === "error" || !payment) return <main className="page-shell narrow-page"><section className="panel-state error-state"><h2>Payment not found</h2><a href="/payments">Return to payments</a></section></main>;
  if (payment.quoteMode === "LIVE_HANDOFF") {
    return <main className="page-shell narrow-page">
      <header className="page-header"><div><h1>{payment.invoice.invoiceNumber}</h1><p>{payment.invoice.vendor.name} · {payment.invoice.currency} {(payment.amountMinor / 100).toFixed(2)}</p></div><span className="status-badge">{payment.status.replaceAll("_", " ")}</span></header>
      <div className="page-nav"><a href="/payments">← Payments</a><a href={`/invoices/${payment.invoice.id}`}>Open invoice</a></div>
      <section className="panel">
        <h2>NEAR mainnet funding</h2>
        <p>{payment.status === "PAID" ? "Finalized Base delivery verified." : payment.status === "REFUNDED" ? "Finalized NEAR refund verified." : payment.transactionHash ? "Origin funding confirmed. Awaiting reconciliation." : "Treasury debit reserved. Awaiting origin funding evidence."}</p>
        {payment.transactionHash && <p className="hash-value">NEAR funding: {payment.transactionHash}</p>}
        {payment.liveEvidence?.destinationTxHash && <p className="hash-value">Base delivery: {payment.liveEvidence.destinationTxHash}</p>}
        {payment.liveEvidence?.refundTxHash && <p className="hash-value">NEAR refund: {payment.liveEvidence.refundTxHash}</p>}
        {payment.liveEvidence?.reconcileIssue && <p role="status">{payment.liveEvidence.reconcileIssue.replaceAll("_", " ")}</p>}
        {payment.liveEvidence && <dl className="detail-list">
          <dt>Origin debit (USDC atomic units)</dt><dd>{payment.liveEvidence.originDebitAtomic}</dd>
          <dt>Payable (USDC atomic units)</dt><dd>{payment.liveEvidence.destinationAmountAtomic}</dd>
          <dt>Verified refund (USDC atomic units)</dt><dd>{payment.liveEvidence.refundedAtomic ?? "—"}</dd>
        </dl>}
      </section>
    </main>;
  }
  let requirements: Record<string, unknown> | null = null;
  try { requirements = payment.quoteMode === "MOCK" && payment.depositRequirementsJson ? JSON.parse(payment.depositRequirementsJson) as Record<string, unknown> : null; } catch { requirements = null; }
  const modeLabel = payment.quoteMode === "REAL_DRY" ? "REAL DRY QUOTE" : payment.quoteMode === "MOCK" ? "MOCK QUOTE" : "UNVERIFIED QUOTE";

  return <main className="page-shell narrow-page"><header className="page-header"><div><p className="eyebrow">Payment quote</p><h1>{payment.invoice.invoiceNumber}</h1><p className="muted">{payment.invoice.vendor.name} · {payment.invoice.currency} {(payment.amountMinor / 100).toFixed(2)}</p></div><span className={`status-badge large-badge ${payment.quoteMode === "REAL_DRY" ? "warning-badge" : ""}`}>{modeLabel}</span></header><div className="page-nav"><a href="/payments">← Payments</a><span>{payment.status}</span></div>
    {message && <div className="form-message success-state">{message}</div>}
    <section className="panel"><p className="eyebrow">Quote details</p><dl className="detail-list"><dt>Provider</dt><dd>{payment.rail}</dd><dt>Quote ID</dt><dd>{payment.quoteId ?? "—"}</dd><dt>Provider status</dt><dd>{payment.providerStatus ?? "—"}</dd><dt>Source</dt><dd>{payment.sourceAsset ?? "—"} · {payment.sourceChain ?? "—"}</dd><dt>Destination</dt><dd>{payment.destinationAsset ?? "—"} · {payment.destinationChain ?? "—"}</dd><dt>Amount</dt><dd>{payment.invoice.currency} {(payment.amountMinor / 100).toFixed(2)}</dd><dt>Estimated received</dt><dd>{payment.estimatedReceivedMinor !== null && payment.estimatedReceivedMinor !== undefined ? `${payment.invoice.currency} ${(payment.estimatedReceivedMinor / 100).toFixed(2)}` : "—"}</dd><dt>Slippage</dt><dd>{payment.slippageBps !== null && payment.slippageBps !== undefined ? `${(payment.slippageBps / 100).toFixed(2)}%` : "—"}</dd><dt>Expiry</dt><dd>{payment.quoteExpiresAt ? new Date(payment.quoteExpiresAt).toLocaleString() : "—"}</dd><dt>Refund destination</dt><dd>{payment.refundDestination ?? "—"}</dd></dl></section>
    <section className="detail-grid">{payment.quoteMode === "MOCK" ? <article className="panel"><p className="eyebrow">Deposit requirements</p><dl className="detail-list compact-list"><dt>Deposit address</dt><dd>{payment.depositAddress ?? "Not supplied"}</dd><dt>Deposit memo</dt><dd>{payment.depositMemo ?? "Not supplied"}</dd></dl>{requirements && <pre className="json-block">{JSON.stringify(requirements, null, 2)}</pre>}</article> : <article className="panel"><h2>Quote preview</h2><p className="muted">Funding is unavailable for this quote.</p></article>}<article className="panel meta-tx-panel"><p className="eyebrow">Meta-transaction design</p><h2>Gas sponsorship boundary</h2><p className="muted">The user authorizes a payment intent. A future relayer or sponsor may cover gas so the user does not manually acquire NEAR. Covendro does not store a full-access private key and this demo stops at a quote or mock simulation.</p><span className="status-badge">NO REAL EXECUTION</span></article></section>
    {payment.quoteMode === "MOCK" && payment.status === "QUOTE_READY" && <section className="panel"><p className="eyebrow">Mock settlement controls</p><p className="muted">These outcomes update local demo state only and do not create an on-chain transaction.</p><div className="action-row"><button onClick={() => void simulate("SUCCESS")} disabled={working}>Simulate success</button><button className="secondary-button" onClick={() => void simulate("REFUNDED")} disabled={working}>Simulate refund</button><button className="secondary-button" onClick={() => void simulate("FAILED")} disabled={working}>Simulate failure</button><button className="secondary-button" onClick={() => void simulate("EXPIRED")} disabled={working}>Simulate expiry</button></div></section>}
    {payment.quoteMode === "MOCK" && payment.transactionHash && <section className="panel"><p className="eyebrow">Settlement result</p><p className="muted">Transaction hash</p><p className="hash-value">{payment.transactionHash}</p></section>}
  </main>;
}
