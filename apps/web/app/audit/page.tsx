"use client";

import { useCallback, useEffect, useState } from "react";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Event = { id: string; eventType: string; description: string; createdAt: string; requestId?: string | null; actor?: { email: string } | null; invoice?: { invoiceNumber: string } | null; payment?: { id: string; quoteId?: string | null } | null };

export default function AuditPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(() => { setState("loading"); fetch(`${apiBase}/api/audit-events?limit=200`).then(async (response) => { if (!response.ok) throw new Error(); return response.json(); }).then((result) => { setEvents(result.data); setState("ready"); }).catch(() => setState("error")); }, []);
  useEffect(() => { void load(); }, [load]);

  return <main className="page-shell"><header className="page-header"><div><p className="eyebrow">Traceability</p><h1>Audit history</h1><p className="muted">Every important workflow action with actor, request, invoice, and payment context.</p></div><a className="button-link" href={`${apiBase}/api/audit-events.csv`}>Export CSV</a></header><div className="page-nav"><a href="/">← Dashboard</a><span>{events.length} events shown</span></div>
    {state === "loading" && <section className="panel-state">Loading audit history…</section>}
    {state === "error" && <section className="panel-state error-state"><h2>Audit history could not be loaded</h2><button onClick={() => void load()}>Retry</button></section>}
    {state === "ready" && events.length === 0 && <section className="panel-state"><div className="empty-icon">◎</div><h2>No audit events yet</h2><p className="muted">Workflow actions will appear here.</p></section>}
    {state === "ready" && events.length > 0 && <section className="panel"><div className="audit-list">{events.map((event) => <div className="audit-row" key={event.id}><span className="status-dot" /><div><strong>{event.eventType}</strong><p className="muted">{event.description}</p><span className="table-subtext">{event.invoice?.invoiceNumber ?? "Workspace event"} · {event.actor?.email ?? "System"} · {event.requestId ?? "No request ID"}</span></div><time>{new Date(event.createdAt).toLocaleString()}</time></div>)}</div></section>}
  </main>;
}
