const navigation = [
  { label: "Dashboard", href: "/" },
  { label: "Invoices", href: "/invoices" },
  { label: "Payments", href: "#" },
  { label: "Treasury policy", href: "#" },
  { label: "Vendors", href: "#" },
  { label: "Audit", href: "#" },
];

export default function HomePage() {
  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-mark">C</div>
        <div>
          <p className="eyebrow">Private treasury OS</p>
          <h1>Covendro</h1>
        </div>
        <nav aria-label="Main navigation">
          {navigation.map((item, index) => (
            <a className={index === 0 ? "nav-item active" : "nav-item"} href={item.href} key={item.label}>
              {item.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" aria-hidden="true" />
          Demo mode enabled
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Treasury workspace</p>
            <h2>Good morning, Treasury Admin</h2>
          </div>
          <span className="role-pill">Treasury administrator</span>
        </header>

        <section className="notice" aria-label="Demo mode notice">
          <div>
            <strong>Demo workspace</strong>
            <p>Payments are simulated. No real funds or private keys are used.</p>
          </div>
          <span className="notice-tag">MOCK RAILS</span>
        </section>

        <section className="hero-card">
          <div>
            <p className="eyebrow">One controlled workflow</p>
            <h3>Move every payable from upload to audit-ready settlement.</h3>
            <p className="muted">
              Upload an invoice, inspect private extraction and risk signals, then approve a
              simulated cross-chain payment.
            </p>
            <a className="button-link" href="/invoices/new">Upload an invoice</a>
          </div>
          <div className="workflow" aria-label="Workflow preview">
            {["Upload", "Verify", "Approve", "Settle"].map((step, index) => (
              <div className="workflow-step" key={step}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <strong>{step}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="metrics" aria-label="Treasury metrics">
          {[
            ["Pending invoices", "0", "No invoices need review"],
            ["Approved amount", "$0.00", "Across approved requests"],
            ["Paid amount", "$0.00", "Simulated settlements"],
            ["Warnings", "0", "Risk signals to review"],
          ].map(([label, value, detail]) => (
            <article className="metric-card" key={label}>
              <p className="eyebrow">{label}</p>
              <strong>{value}</strong>
              <p className="muted">{detail}</p>
            </article>
          ))}
        </section>

        <section className="empty-state">
          <div className="empty-icon">◎</div>
          <h3>Your payable queue is clear</h3>
          <p className="muted">Upload a fictional sample invoice to begin the complete MVP workflow.</p>
          <a className="button-link secondary-button" href="/invoices/new">Browse sample invoices</a>
        </section>
      </section>
    </main>
  );
}
