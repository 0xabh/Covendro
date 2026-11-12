"use client";

import { FormEvent, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Policy = {
  id: string;
  version: number;
  maxPaymentPerTransactionMinor: number;
  maxDailyPaymentTotalMinor: number;
  allowedCurrencies: string[];
  allowedChains: string[];
  allowedRecipients: string[];
  requireApprovalAboveMinor: number;
  blockUnknownRecipients: boolean;
  warningsRequireManualReview: boolean;
  allowSelfApproval: boolean;
  freezePayments: boolean;
  demoMode: boolean;
  treasuryIdentity?: { name: string; nearAccountId: string; keyPurpose: string; accessKeyPermissionScope: string; keyType: string; demoIdentity: boolean } | null;
};

function dollars(minor: number) { return (minor / 100).toFixed(2); }
function minor(value: string) { return Math.round(Number(value) * 100); }

export default function TreasuryPolicyPage() {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${apiBase}/api/policies`, { headers: { "x-demo-user-email": "treasury@covendro.local" } })
      .then(async (response) => { if (!response.ok) throw new Error("Policy could not be loaded"); return response.json(); })
      .then((result) => { setPolicy(result.data.active ? { ...result.data.active, treasuryIdentity: result.data.treasuryIdentity } : null); setState("ready"); })
      .catch(() => setState("error"));
  }, []);

  function update<K extends keyof Policy>(field: K, value: Policy[K]) {
    setPolicy((current) => current ? { ...current, [field]: value } : current);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`${apiBase}/api/policies/${policy.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json", "x-demo-user-email": "treasury@covendro.local" },
        body: JSON.stringify({
          maxPaymentPerTransactionMinor: policy.maxPaymentPerTransactionMinor,
          maxDailyPaymentTotalMinor: policy.maxDailyPaymentTotalMinor,
          allowedCurrencies: policy.allowedCurrencies,
          allowedChains: policy.allowedChains,
          allowedRecipients: policy.allowedRecipients,
          requireApprovalAboveMinor: policy.requireApprovalAboveMinor,
          blockUnknownRecipients: policy.blockUnknownRecipients,
          warningsRequireManualReview: policy.warningsRequireManualReview,
          allowSelfApproval: policy.allowSelfApproval,
          freezePayments: policy.freezePayments,
          demoMode: policy.demoMode,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? "Policy could not be saved");
      setPolicy((current) => current ? { ...result.data, treasuryIdentity: current.treasuryIdentity } : result.data); setMessage(`Policy v${result.data.version} saved.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Policy could not be saved"); }
    finally { setSaving(false); }
  }

  async function toggleFreeze() {
    if (!policy) return;
    const action = policy.freezePayments ? "unfreeze" : "freeze";
    const response = await fetch(`${apiBase}/api/policies/${policy.id}/${action}`, { method: "POST", headers: { "x-demo-user-email": "treasury@covendro.local" } });
    const result = await response.json();
    if (!response.ok) { setMessage(result.error?.message ?? "Freeze state could not be changed"); return; }
    setPolicy((current) => current ? { ...result.data, treasuryIdentity: current.treasuryIdentity } : result.data); setMessage(result.data.freezePayments ? "Treasury frozen." : "Treasury unfrozen.");
  }

  if (state === "loading") return <main className="page-shell"><section className="panel-state">Loading treasury policy…</section></main>;
  if (state === "error" || !policy) return <main className="page-shell"><section className="panel-state error-state"><h2>Policy could not be loaded</h2><p className="muted">Check that the API is running, then reload.</p></section></main>;

  return <main className="page-shell narrow-page">
    <header className="page-header"><div><p className="eyebrow">Treasury controls</p><h1>Policy</h1><p className="muted">Version {policy.version}. Changes create a new immutable policy version and an audit event.</p></div><span className={`status-badge ${policy.freezePayments ? "danger-badge" : ""}`}>{policy.freezePayments ? "FROZEN" : "ACTIVE"}</span></header>
    <div className="page-nav"><a href="/">← Dashboard</a><span>Demo administrator · policy changes are local</span></div>
    {message && <div className="form-message success-state">{message}</div>}
    {policy.treasuryIdentity && <section className="panel identity-panel"><p className="eyebrow">NEAR treasury identity</p><h2>{policy.treasuryIdentity.name}</h2><dl className="detail-list compact-list"><dt>Account</dt><dd>{policy.treasuryIdentity.nearAccountId}</dd><dt>Key type</dt><dd>{policy.treasuryIdentity.keyType}</dd><dt>Purpose</dt><dd>{policy.treasuryIdentity.keyPurpose}</dd><dt>Scope</dt><dd>{policy.treasuryIdentity.accessKeyPermissionScope}</dd></dl><p className="muted">Demo metadata only. No private key or transfer authority is stored.</p></section>}
    <form className="panel invoice-form" onSubmit={save}>
      <div className="form-section"><p className="eyebrow">Limits</p><div className="form-grid">
        <label>Maximum per transaction (USDC)<input required type="number" min="0" step="0.01" value={dollars(policy.maxPaymentPerTransactionMinor)} onChange={(event) => update("maxPaymentPerTransactionMinor", minor(event.target.value))} /></label>
        <label>Maximum daily total (USDC)<input required type="number" min="0" step="0.01" value={dollars(policy.maxDailyPaymentTotalMinor)} onChange={(event) => update("maxDailyPaymentTotalMinor", minor(event.target.value))} /></label>
        <label>Approval threshold (USDC)<input required type="number" min="0" step="0.01" value={dollars(policy.requireApprovalAboveMinor)} onChange={(event) => update("requireApprovalAboveMinor", minor(event.target.value))} /></label>
      </div></div>
      <div className="form-section"><p className="eyebrow">Allowlist</p><div className="form-grid">
        <label>Allowed currencies<input value={policy.allowedCurrencies.join(", ")} onChange={(event) => update("allowedCurrencies", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
        <label>Allowed chains<input value={policy.allowedChains.join(", ")} onChange={(event) => update("allowedChains", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} /></label>
        <label className="wide-field">Allowed recipients<textarea value={policy.allowedRecipients.join("\n")} onChange={(event) => update("allowedRecipients", event.target.value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean))} /></label>
      </div></div>
      <div className="form-section checkbox-grid">
        <label><input type="checkbox" checked={policy.blockUnknownRecipients} onChange={(event) => update("blockUnknownRecipients", event.target.checked)} /> Block unknown recipients</label>
        <label><input type="checkbox" checked={policy.warningsRequireManualReview} onChange={(event) => update("warningsRequireManualReview", event.target.checked)} /> Warnings require manual review</label>
        <label><input type="checkbox" checked={policy.allowSelfApproval} onChange={(event) => update("allowSelfApproval", event.target.checked)} /> Allow request creator to approve (demo only)</label>
        <label><input type="checkbox" checked={policy.demoMode} onChange={(event) => update("demoMode", event.target.checked)} /> Demo mode</label>
      </div>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={() => void toggleFreeze()}>{policy.freezePayments ? "Unfreeze treasury" : "Freeze treasury"}</button><button type="submit" disabled={saving}>{saving ? "Saving…" : "Save new policy version"}</button></div>
    </form>
  </main>;
}
