"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
} from "@ui-sdk/react/progress";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Dashboard = {
  pendingInvoices: number;
  approvedAmountMinor: number;
  paidAmountMinor: number;
  warningCount: number;
  blockedCount: number;
  currentPolicy: {
    version: number;
    demoMode: boolean;
    freezePayments: boolean;
    allowedCurrencies: string[];
    allowedChains: string[];
  } | null;
  recentActivity: Array<{
    id: string;
    eventType: string;
    description: string;
    createdAt: string;
  }>;
};
type IntegrationStatus = {
  ai: {
    configured: boolean;
    provider: string;
    model: string;
    verificationState: string;
  };
  intents: {
    configured: boolean;
    provider: string;
    mode: string;
    executionEnabled: boolean;
  };
  treasury: {
    accountId: string | null;
    keyType: string;
    permissionScope: string;
    accountVerification: { state: string; accessKeyCount?: number | null };
  };
};
function amount(minor: number) {
  return `USDC ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

export default function HomePage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [integrations, setIntegrations] = useState<IntegrationStatus | null>(
    null,
  );
  const [integrationState, setIntegrationState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const load = useCallback(() => {
    setState("loading");
    setIntegrationState("loading");
    Promise.all([
      fetch(`${apiBase}/api/dashboard`),
      fetch(`${apiBase}/api/integrations/status`),
    ])
      .then(async ([dashboardResponse, integrationResponse]) => {
        if (!dashboardResponse.ok || !integrationResponse.ok) throw new Error();
        return Promise.all([
          dashboardResponse.json(),
          integrationResponse.json(),
        ]);
      })
      .then(([dashboardResult, integrationResult]) => {
        setDashboard(dashboardResult.data);
        setIntegrations(integrationResult.data);
        setState("ready");
        setIntegrationState("ready");
      })
      .catch(() => {
        setState("error");
        setIntegrationState("error");
      });
  }, []);
  async function verifyAccount() {
    setIntegrationState("loading");
    try {
      const response = await fetch(
        `${apiBase}/api/integrations/status?verifyAccount=true`,
      );
      if (!response.ok) throw new Error();
      const result = await response.json();
      setIntegrations(result.data);
      setIntegrationState("ready");
    } catch {
      setIntegrationState("error");
    }
  }
  useEffect(() => {
    void load();
  }, [load]);
  const accountVerificationBusy = integrationState === "loading";
  const metricItems = dashboard
    ? [
        [
          "Pending invoices",
          String(dashboard.pendingInvoices),
          "Open workflow requests",
        ],
        [
          "Approved amount",
          amount(dashboard.approvedAmountMinor),
          "Approved but not paid",
        ],
        [
          "Paid amount",
          amount(dashboard.paidAmountMinor),
          "Simulated settlements",
        ],
        [
          "Warnings",
          String(dashboard.warningCount),
          `${dashboard.blockedCount} blocked payment${dashboard.blockedCount === 1 ? "" : "s"}`,
        ],
      ]
    : [];

  return (
    <main className="dashboard-page">
      <header className="topbar">
        <div>
          <p className="eyebrow">Treasury workspace</p>
          <h1>Good morning, Treasury Admin</h1>
          <p className="topbar-subtitle">
            One control plane for every payable decision.
          </p>
        </div>
        <div className="topbar-actions">
          <a className="text-link" href="/audit">
            View audit
          </a>
          <a className="button-link compact-button" href="/invoices/new">
            New invoice
          </a>
          <span className="role-pill">Treasury administrator</span>
        </div>
      </header>
      <section className="notice" aria-label="Demo mode notice">
        <div className="notice-copy">
          <span className="live-dot" aria-hidden="true" />
          <div>
            <strong>Demo workspace</strong>
            <p>
              Payments are simulated. No real funds or private keys are used.
            </p>
          </div>
        </div>
        <span className="notice-tag">MOCK RAILS</span>
      </section>
      <section className="hero-card">
        <div>
          <p className="eyebrow">One controlled workflow</p>
          <h2>Move every payable from upload to audit-ready settlement.</h2>
          <p className="muted">
            Upload an invoice, inspect private extraction and risk signals, then
            approve a simulated cross-chain payment.
          </p>
          <a className="button-link" href="/invoices/new">
            Upload an invoice
          </a>
          <div className="hero-meta">
            <span>Server-side controls</span>
            <span>No private keys</span>
            <span>Dry by default</span>
          </div>
        </div>
        <div className="workflow" aria-label="Workflow preview">
          {["Upload", "Verify", "Approve", "Settle"].map((step, index) => (
            <div className="workflow-step" key={step}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <strong>{step}</strong>
              <b>↗</b>
            </div>
          ))}
        </div>
      </section>
      {state === "loading" && (
        <section className="panel-state dashboard-state">
          Loading treasury metrics…
        </section>
      )}
      {state === "error" && (
        <section className="panel-state error-state dashboard-state">
          <h2>Dashboard could not be loaded</h2>
          <p className="muted">Check that the API is running, then retry.</p>
          <button onClick={() => void load()}>Retry</button>
        </section>
      )}
      {state === "ready" && dashboard && (
        <>
          <section className="metrics" aria-label="Treasury metrics">
            {metricItems.map(([label, value, detail], index) => (
              <article
                className={`metric-card metric-card-${index + 1}`}
                key={label}
              >
                <span className="metric-index">0{index + 1}</span>
                <p className="eyebrow">{label}</p>
                <strong>{value}</strong>
                <p className="muted">{detail}</p>
              </article>
            ))}
          </section>
          <section className="control-strip" aria-label="Workflow health">
            <div>
              <p className="eyebrow">Workflow health</p>
              <strong>
                {dashboard.pendingInvoices === 0
                  ? "Queue clear"
                  : `${dashboard.pendingInvoices} invoices need attention`}
              </strong>
              <p className="muted">
                Every invoice is evaluated against deterministic risk and policy
                controls.
              </p>
            </div>
            <div className="health-progress">
              <div className="progress-label">
                <span>Control coverage</span>
                <strong>{dashboard.warningCount === 0 ? "100%" : "92%"}</strong>
              </div>
              <Progress
                value={dashboard.warningCount === 0 ? 100 : 92}
                max={100}
                aria-label="Control coverage"
              >
                <ProgressTrack>
                  <ProgressIndicator />
                </ProgressTrack>
              </Progress>
            </div>
            <a className="text-link" href="/audit">
              Inspect evidence →
            </a>
          </section>
          {integrationState === "ready" && integrations && (
            <section className="panel integration-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">NEAR control center</p>
                  <h2>Integration truth, at a glance</h2>
                  <p className="muted">
                    Credentials stay server-side. This panel exposes provider
                    state without exposing secrets.
                  </p>
                </div>
                <span className="status-badge">READ-ONLY</span>
              </div>
              <div className="integration-grid">
                <article className="integration-card">
                  <p className="eyebrow">Private extraction</p>
                  <strong>{integrations.ai.provider}</strong>
                  <span
                    className={`status-badge ${integrations.ai.configured ? "" : "warning-badge"}`}
                  >
                    {integrations.ai.configured
                      ? "LIVE CONFIGURED"
                      : "MOCK FALLBACK"}
                  </span>
                  <p className="table-subtext">
                    {integrations.ai.model} ·{" "}
                    {integrations.ai.verificationState}
                  </p>
                </article>
                <article className="integration-card">
                  <p className="eyebrow">Cross-chain quote</p>
                  <strong>{integrations.intents.provider}</strong>
                  <span
                    className={`status-badge ${integrations.intents.mode === "REAL_DRY" ? "" : "warning-badge"}`}
                  >
                    {integrations.intents.mode}
                  </span>
                  <p className="table-subtext">
                    Execution{" "}
                    {integrations.intents.executionEnabled
                      ? "enabled"
                      : "disabled"}{" "}
                    · no browser secrets
                  </p>
                </article>
                <article className="integration-card">
                  <p className="eyebrow">Treasury identity</p>
                  <strong>
                    {integrations.treasury.accountId ?? "Not configured"}
                  </strong>
                  <span className="status-badge">
                    {integrations.treasury.accountVerification.state}
                  </span>
                  <p className="table-subtext">
                    {integrations.treasury.keyType} ·{" "}
                    {integrations.treasury.permissionScope}
                  </p>
                  {integrations.treasury.accountVerification.accessKeyCount !==
                    undefined && (
                    <p className="table-subtext">
                      {integrations.treasury.accountVerification
                        .accessKeyCount ?? "—"}{" "}
                      access keys observed via RPC
                    </p>
                  )}
                </article>
              </div>
              <div className="integration-actions">
                <span className="muted">
                  Account verification is read-only and never signs or submits a
                  transaction.
                </span>
                <button
                  className="secondary-button"
                  onClick={() => void verifyAccount()}
                  disabled={accountVerificationBusy}
                >
                  Verify NEAR account
                </button>
              </div>
            </section>
          )}
          <section className="detail-grid">
            <article className="panel policy-panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Current policy</p>
                  <h2>
                    {dashboard.currentPolicy
                      ? `Policy v${dashboard.currentPolicy.version}`
                      : "No active policy"}
                  </h2>
                </div>
                <span
                  className={`status-badge ${dashboard.currentPolicy?.freezePayments ? "danger-badge" : ""}`}
                >
                  {dashboard.currentPolicy?.freezePayments
                    ? "FROZEN"
                    : "ACTIVE"}
                </span>
              </div>
              {dashboard.currentPolicy ? (
                <>
                  <p className="muted">
                    {dashboard.currentPolicy.freezePayments
                      ? "Payment execution is frozen."
                      : "Payment execution is ready for review."}{" "}
                    {dashboard.currentPolicy.demoMode
                      ? "Demo mode is enabled."
                      : "Demo mode is disabled."}
                  </p>
                  <p className="table-subtext">
                    {dashboard.currentPolicy.allowedCurrencies.join(", ")} ·{" "}
                    {dashboard.currentPolicy.allowedChains.join(", ")}
                  </p>
                  <a
                    className="button-link secondary-button"
                    href="/treasury-policy"
                  >
                    Review policy
                  </a>
                </>
              ) : (
                <p className="muted">
                  Create a policy to control payment decisions.
                </p>
              )}
            </article>
            <article className="panel">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">Recent activity</p>
                  <h2>Latest decisions</h2>
                </div>
                <span className="activity-count">
                  {dashboard.recentActivity.length} events
                </span>
              </div>
              {dashboard.recentActivity.length === 0 ? (
                <p className="muted">No activity yet.</p>
              ) : (
                <div className="audit-list">
                  {dashboard.recentActivity.slice(0, 5).map((event) => (
                    <div className="audit-row" key={event.id}>
                      <span className="status-dot" />
                      <div>
                        <strong>{event.eventType.replaceAll("_", " ")}</strong>
                        <p className="muted">{event.description}</p>
                      </div>
                      <time>
                        {new Date(event.createdAt).toLocaleDateString()}
                      </time>
                    </div>
                  ))}
                </div>
              )}
              <a className="table-subtext" href="/audit">
                View full audit history →
              </a>
            </article>
          </section>
          <section className="panel">
            <p className="eyebrow">Judge scenarios</p>
            <h2>Run the safety story</h2>
            <p className="muted">
              Each scenario starts with fictional data and enters the same
              controlled workflow.
            </p>
            <div className="scenario-grid">
              <a
                className="scenario-card"
                href="/invoices/new?fixture=sample-invoice-001.json"
              >
                <span>01 · BASELINE</span>
                <strong>Allow a known recipient</strong>
                <span>Open invoice →</span>
              </a>
              <a
                className="scenario-card"
                href="/invoices/new?fixture=suspicious-invoice.json"
              >
                <span>02 · ADVERSARIAL</span>
                <strong>Review an unusual payable</strong>
                <span>Open invoice →</span>
              </a>
              <a className="scenario-card" href="/treasury-policy">
                <span>03 · CONTROL</span>
                <strong>Freeze the treasury policy</strong>
                <span>Open policy →</span>
              </a>
            </div>
          </section>
        </>
      )}
      {state === "ready" && dashboard?.recentActivity.length === 0 && (
        <section className="empty-state">
          <div className="empty-icon">◎</div>
          <h3>Your payable queue is clear</h3>
          <p className="muted">
            Upload a fictional sample invoice to begin the complete MVP
            workflow.
          </p>
          <a className="button-link secondary-button" href="/invoices/new">
            Browse sample invoices
          </a>
        </section>
      )}
    </main>
  );
}
