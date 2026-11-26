"use client";

import { useEffect, useState } from "react";

import { apiBase, apiFetch, pilotMode } from "../../lib/api";
type Destination = { id: string; chain: string; address: string; verifiedAt: string | null; revokedAt: string | null };
type Vendor = { id: string; name: string; accountAddress: string; accountChain?: string | null; allowlisted: boolean; riskStatus: string; destinations: Destination[]; _count: { invoices: number } };

function VendorDestinations({ vendor, role, reload }: { vendor: Vendor; role: string; reload: () => void }) {
  const [chain, setChain] = useState("base");
  const [address, setAddress] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const administrator = role === "TREASURY_ADMINISTRATOR";

  async function update(path: string, body?: unknown) {
    setError("");
    setWorking(true);
    try {
      const response = await apiFetch(`${apiBase}/api/vendors/${vendor.id}/destinations${path}`, {
        method: "POST",
        ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error((await response.json()).error?.message ?? "Destination update failed");
      setAddress("");
      setConfirmed(false);
      reload();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Destination update failed");
    } finally {
      setWorking(false);
    }
  }

  return <section className="panel">
    <h2>{vendor.name}</h2>
    {vendor.destinations.length === 0 && <p>No destinations recorded.</p>}
    {administrator && vendor.destinations.some((destination) => !destination.verifiedAt && !destination.revokedAt) &&
      <label><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I confirmed this address through an established vendor contact.</label>}
    <ul>
      {vendor.destinations.map((destination) => <li key={destination.id}>
        <span>{destination.chain} · {destination.address} · {destination.revokedAt ? "Revoked" : destination.verifiedAt ? "Verified" : "Pending verification"}</span>
        {administrator && !destination.revokedAt && <>
          {!destination.verifiedAt && <button disabled={!confirmed || working} onClick={() => void update(`/${destination.id}/verify`, { confirmedWithKnownContact: true })}>Verify</button>}
          <button disabled={working} onClick={() => void update(`/${destination.id}/revoke`)}>Revoke</button>
        </>}
      </li>)}
    </ul>
    {(administrator || role === "REVIEWER") && <form className="action-row" onSubmit={(event) => {
      event.preventDefault();
      void update("", { chain, address: address.trim() });
    }}>
      <label>Chain <select value={chain} onChange={(event) => setChain(event.target.value)}><option value="base">Base</option><option value="near">NEAR</option></select></label>
      <label>Destination <input required value={address} onChange={(event) => setAddress(event.target.value)} /></label>
      <button disabled={working}>Propose destination</button>
    </form>}
    {error && <p role="alert">{error}</p>}
  </section>;
}

export default function VendorsPage() {
  const [role, setRole] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = () => { setState("loading"); apiFetch(`${apiBase}/api/vendors`).then(async (response) => { if (!response.ok) throw new Error(); return response.json(); }).then((result) => { setVendors(result.data); setState("ready"); }).catch(() => setState("error")); };
  useEffect(load, []);
  useEffect(() => {
    if (!pilotMode) return;
    apiFetch(`${apiBase}/api/session`)
      .then(async (response) => response.ok ? (await response.json()).data.role : "")
      .then(setRole)
      .catch(() => setRole(""));
  }, []);

  return <main className="page-shell"><header className="page-header"><div><p className="eyebrow">Recipients</p><h1>Vendors</h1><p className="muted">Allowlist state and explainable risk outcomes for payment recipients.</p></div></header><div className="page-nav"><a href="/">← Dashboard</a><span>Risk decisions are deterministic and independent from AI.</span></div>
    {state === "loading" && <section className="panel-state">Loading vendors…</section>}
    {state === "error" && <section className="panel-state error-state"><h2>Vendors could not be loaded</h2><button onClick={load}>Retry</button></section>}
    {state === "ready" && vendors.length === 0 && <section className="panel-state"><h2>No vendors yet</h2><p className="muted">Vendors appear after the first invoice is submitted.</p></section>}
    {state === "ready" && vendors.length > 0 && <section className="table-panel"><table><thead><tr><th>Vendor</th><th>Account</th><th>Allowlist</th><th>Risk</th><th>Invoices</th></tr></thead><tbody>{vendors.map((vendor) => <tr key={vendor.id}><td><strong>{vendor.name}</strong></td><td><span className="table-subtext">{vendor.accountAddress}</span><span className="table-subtext">{vendor.accountChain ?? "chain not set"}</span></td><td><span className="status-badge">{vendor.allowlisted ? "ALLOWED" : "UNKNOWN"}</span></td><td><span className={`status-badge ${vendor.riskStatus === "BLOCK" ? "danger-badge" : vendor.riskStatus === "WARN" ? "warning-badge" : ""}`}>{vendor.riskStatus}</span></td><td>{vendor._count.invoices}</td></tr>)}</tbody></table></section>}
    {pilotMode && state === "ready" && vendors.map((vendor) => <VendorDestinations key={vendor.id} vendor={vendor} reload={load} role={role} />)}
  </main>;
}
