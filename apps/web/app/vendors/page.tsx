"use client";

import { useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Vendor = { id: string; name: string; accountAddress: string; accountChain?: string | null; allowlisted: boolean; riskStatus: string; _count: { invoices: number } };

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = () => { setState("loading"); fetch(`${apiBase}/api/vendors`).then(async (response) => { if (!response.ok) throw new Error(); return response.json(); }).then((result) => { setVendors(result.data); setState("ready"); }).catch(() => setState("error")); };
  useEffect(load, []);

  return <main className="page-shell"><header className="page-header"><div><p className="eyebrow">Recipients</p><h1>Vendors</h1><p className="muted">Allowlist state and explainable risk outcomes for payment recipients.</p></div></header><div className="page-nav"><a href="/">← Dashboard</a><span>Risk decisions are deterministic and independent from AI.</span></div>
    {state === "loading" && <section className="panel-state">Loading vendors…</section>}
    {state === "error" && <section className="panel-state error-state"><h2>Vendors could not be loaded</h2><button onClick={load}>Retry</button></section>}
    {state === "ready" && vendors.length === 0 && <section className="panel-state"><h2>No vendors yet</h2><p className="muted">Vendors appear after the first invoice is submitted.</p></section>}
    {state === "ready" && vendors.length > 0 && <section className="table-panel"><table><thead><tr><th>Vendor</th><th>Account</th><th>Allowlist</th><th>Risk</th><th>Invoices</th></tr></thead><tbody>{vendors.map((vendor) => <tr key={vendor.id}><td><strong>{vendor.name}</strong></td><td><span className="table-subtext">{vendor.accountAddress}</span><span className="table-subtext">{vendor.accountChain ?? "chain not set"}</span></td><td><span className="status-badge">{vendor.allowlisted ? "ALLOWED" : "UNKNOWN"}</span></td><td><span className={`status-badge ${vendor.riskStatus === "BLOCK" ? "danger-badge" : vendor.riskStatus === "WARN" ? "warning-badge" : ""}`}>{vendor.riskStatus}</span></td><td>{vendor._count.invoices}</td></tr>)}</tbody></table></section>}
  </main>;
}
