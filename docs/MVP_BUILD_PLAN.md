# Covendro MVP Build Plan

## Purpose

This document describes how Covendro will be built as one complete vertical slice:

```text
invoice upload
  → private extraction
  → verification result
  → vendor risk assessment
  → treasury approval policy
  → payment quote
  → simulated settlement
  → ledger and audit history
```

The implementation is intentionally divided into small milestones. The application should remain runnable after every milestone, and every milestone ends with automated checks plus a short manual workflow verification.

## How many steps are needed?

There are 9 milestones in total:

- Milestone 0 is complete.
- Milestones 3–8 remain.
- The working mock-mode MVP should be usable after Milestone 7.
- Milestone 8 is the quality, documentation, and demo-readiness pass required for the final definition of done.

No external credential is required for the default demo. Credentials are optional during ordinary development, but the real NEAR AI Cloud and NEAR Intents paths become submission-critical integration checks when credentials are available.

## Hackathon submission scope

The default demo must work without credentials, but the following capabilities are submission-critical when credentials are available:

- The complete invoice-to-payment vertical slice must work in mock mode.
- The NEAR AI Cloud adapter must be implemented and verified against the configured OpenAI-compatible endpoint.
- The NEAR Intents/1Click adapter must be implemented and verified with a real dry quote when configured.
- Mock and real-provider results must be visibly distinguished in the UI and README.
- Treasury identities must represent NEAR accounts and access-key permissions without storing private keys.
- The payment flow must document and display its meta-transaction design, including gas sponsorship/relayer boundaries.

Real mainnet execution is not required for submission and remains disabled by default. A fake NEAR Intents testnet is prohibited; the fallback must be a clearly labelled mock quote.

## Hackathon submission compliance checklist

Technical MVP completion and hackathon submission compliance are separate gates. The current project is **not submission-ready yet**: Milestones 0–2 are complete, the latest work has not been pushed to GitHub, and no public demo post or submission form has been completed.

The current NEAR Hackathon instructions require a working prototype in a public repository, a public demo post on X containing a demo video or screenshots and the `@NEARProtocol` / `#NEARHackathon` references, and submission of both links through the form. The form also asks for the project name, team details, selected tracks, a NEAR wallet address, repository link, demo-post link, and a short project description. The live organizer instructions are the source of truth and must be rechecked immediately before submission.

### Pre-submission checklist

- [ ] Milestones 0–8 pass their technical acceptance checks.
- [ ] The repository is public and contains the final code, README, fixtures, migrations, and setup instructions.
- [ ] The README includes a judge-friendly `do X, see Y` walkthrough that works from a clean checkout.
- [ ] No `.env` file, API key, JWT, private key, database file, or real financial document is present in Git history.
- [ ] The public demo shows the complete invoice-to-payment workflow in mock mode.
- [ ] The demo visibly distinguishes mocked AI, real-provider AI, mock quotes, real dry quotes, and simulated payment outcomes.
- [ ] NEAR AI Cloud integration evidence is available when configured, or the README explains the credential limitation without claiming the integration ran.
- [ ] NEAR Intents/1Click dry-quote evidence is available when configured, or the README explains the credential limitation without claiming a real quote.
- [ ] A public demo post is prepared with a short video or screenshots and the required NEAR hackathon wording/tags.
- [ ] The final submission form has the correct project description, team details, track selection, NEAR wallet address, repository link, and demo-post link.
- [ ] The user explicitly approves any GitHub push, public post, or submission action before it happens.

### Current compliance status

| Requirement | Current status |
| --- | --- |
| Working prototype | In progress; invoice intake works, later workflow milestones remain |
| Public repository | Remote exists, but current work is not pushed |
| README/setup path | Partially complete; final judge walkthrough remains |
| Public demo video/screenshots | Not created |
| Demo post on X | Not created |
| Submission form | Not completed |
| NEAR wallet payout address | Required from the submitter at final submission |
| NEAR track selection | To be finalized after the working demo is complete |

## Delivery method used for every milestone

For each milestone, the implementation will follow this loop:

1. State the objective and the files or modules in scope.
2. Implement the smallest coherent slice.
3. Add or update unit and integration tests immediately.
4. Run typecheck, lint, and the relevant test suites.
5. Start the local application and manually verify the affected workflow.
6. Fix failures before moving forward.
7. Report what changed, what passed, what remains, and whether input is needed.

The default implementation choices are:

- Next.js, React, TypeScript, and responsive web UI.
- Fastify REST API with request IDs and consistent errors.
- SQLite with Prisma for local persistence.
- Zod for input validation.
- Deterministic mock adapters for AI and payment rails.
- Optional NEAR AI Cloud and NEAR Intents adapters, disabled by default.
- Demo authentication with seeded roles before wallet authentication is considered.

## Milestone 0 — Repository and architecture scaffold

Status: **Complete**

### Objective

Create a clean, runnable foundation without pretending that any payment or verification integration is already real.

### Work completed

- Created npm workspaces for `apps/web`, `apps/api`, and `packages/shared`.
- Added a Next.js dashboard shell with explicit demo-mode messaging.
- Added a Fastify API with `GET /health`.
- Added shared TypeScript types.
- Added `.env.example` with safe defaults and optional NEAR integration variables.
- Added TypeScript, ESLint, Vitest, and production build scripts.
- Added an initial health endpoint test.
- Added README architecture, setup, privacy boundary, and limitation notes.

### Completion checks

- Typecheck passes.
- Lint passes.
- Unit test passes.
- API health endpoint responds with `demoMode: true`.
- Frontend production build succeeds and serves the dashboard shell.

### Input needed from you

None. The scaffold uses safe defaults and does not require credentials.

## Milestone 1 — Database and domain model

Status: **Complete**

### Objective

Introduce local persistence and the domain entities required by the vertical slice, while keeping repositories and business logic separate from HTTP routes.

### Work completed

- Add Prisma and SQLite configuration.
- Create schema models for:
  - users and organizations
  - vendors and recipient allowlists
  - invoices and extracted invoice fields
  - treasury policies and policy versions
  - approvals
  - payments and quotes
  - ledger entries
  - audit events
- Add database migration and seed command.
- Keep the initial SQL migration checked into `prisma/migrations`.
- Seed demo users for administrator, reviewer, and submitter roles.
- Add treasury identity/access-key metadata: NEAR account, key purpose, permission scope, and whether the identity is a demo or configured identity. Store no private-key material.
- Seed a treasury policy and fictional vendors.
- Add repository/service boundaries for future routes.
- Add database health information to the API without exposing secrets.
- Add a deterministic local SQLite bootstrap command for environments where the Prisma schema engine cannot run.

### Completion checks

- A new developer can create the database from scratch using README commands.
- Seed data creates all demo roles and a policy.
- Seed data creates a fictional treasury identity with a documented limited access-key scope.
- Prisma schema passes validation.
- Repository tests can create and read a record in a temporary SQLite database.
- Existing health endpoint and dashboard still work.

The local setup command applies the checked-in SQL through the system SQLite CLI because the current Node 24 environment returns an empty Prisma schema-engine error for `migrate dev` and `migrate deploy`. `npm run db:migrate:prisma` remains available for environments where the Prisma migration engine runs normally.

### Input needed from you

None. The default policy and demo identities will be fictional and local-only. You may later suggest different seeded names or policy thresholds, but implementation can proceed without that input.

## Milestone 2 — Invoice intake and validation

Status: **Complete**

### Objective

Make invoice submission usable from the browser, with strong validation and safe duplicate handling.

### Work completed

- Add fictional JSON fixtures:
  - normal invoice
  - suspicious invoice
  - duplicate invoice scenario
- Add manual-entry form and fixture upload flow.
- Support JSON fixtures, plain-text documents, and text-based PDF documents.
- Parse documents server-side into candidate fields for user review before saving.
- Keep manual entry available when parsing is incomplete or a PDF is scanned/image-only.
- Validate vendor, invoice number, dates, currency, amount, line items, and payment destination with Zod.
- Reject unsupported currencies, invalid dates, missing amounts, and malformed destinations.
- Compute a file hash when a document is supplied.
- Persist extracted fields and metadata, but not the original document.
- Add duplicate detection by vendor and invoice number.
- Add invoice list and invoice detail pages.
- Preserve the submission-critical workflow contract so later AI, policy, approval, and payment milestones operate on the same invoice record.

### Completion checks

- A submitter can create an invoice from a fixture or manual entry.
- Invalid input returns useful field-level errors.
- Duplicate invoice numbers for the same vendor are rejected or flagged deterministically.
- Original documents are not persisted after processing.
- The invoice detail page shows the current workflow status.
- Text-based PDF and plain-text uploads return candidate invoice fields without persisting original content.
- A scanned/image-only PDF produces a clear parse error and remains recoverable through manual entry.

### Input needed from you

None. Only fictional sample invoices will be used. Do not provide real personal or financial documents.

## Milestone 3 — Private AI abstraction and verification panel

Status: Planned

### Objective

Add private extraction and anomaly detection behind an adapter interface, while making mocked, unverified, and verified results visually distinct.

### Work to build

- Define `InvoiceAIProvider`.
- Implement deterministic `MockInvoiceAIProvider`.
- Implement `NearAICloudProvider` using the OpenAI-compatible API. This adapter is required for hackathon readiness when credentials are configured, even though mock mode remains the default.
- Read the NEAR AI Cloud key only on the server.
- Use structured JSON output and avoid logging invoice contents.
- Add anomaly detection for unusual amounts, missing fields, and duplicate signals.
- Persist provider, model, confidence, request ID, timestamp, and verification state.
- Add verification states:
  - `MOCKED`
  - `UNVERIFIED`
  - `VERIFIED`
  - `VERIFICATION_FAILED`
- Add a reusable verification panel with a plain-language explanation.
- Ensure the UI never displays `VERIFIED` unless the verification code actually succeeds.

### Completion checks

- Mock extraction works with no credentials.
- External calls are skipped in tests unless explicitly configured.
- AI content is not written to logs.
- The verification panel distinguishes mocked and real-provider results.
- A configured NEAR AI Cloud request can be demonstrated without exposing the API key or invoice contents in logs.
- Unit tests cover extraction, anomaly detection, provider selection, and verification states.

### Input needed from you

- None for mock mode.
- Optional during ordinary development, but required for final integration verification if the hackathon environment provides credentials: a NEAR AI Cloud API key and model name supplied through local environment variables only. Never paste credentials into source files or commit them.

## Milestone 4 — Vendor risk and treasury policy engine

Status: Planned

### Objective

Make payment decisions explainable and independent from AI output.

### Work to build

- Define `VendorRiskService` with deterministic rules.
- Add allowlist and previous-payment signals.
- Detect duplicate invoices, unusual amounts, changed destinations, invalid account formats, and incomplete vendor data.
- Add policy evaluation for transaction maximum, daily total, allowed currencies, chains, recipients, approval thresholds, warnings, freeze state, and demo mode.
- Return structured `ALLOW`, `WARN`, or `BLOCK` decisions with reasons, required approvals, and policy version.
- Add treasury policy page and edit form.
- Add freeze/unfreeze controls.
- Add policy version audit events.
- Connect policy decisions to the treasury identity/access-key scope so the reviewer can see which identity is authorized to approve or relay a payment.

### Completion checks

- A known recipient can be allowed.
- An unknown or malformed recipient can be warned or blocked.
- Exceeding transaction or daily limits blocks the payment.
- A frozen treasury blocks all payment attempts.
- Policy and vendor decisions include human-readable reasons.

### Input needed from you

None. The policy in the user brief will be the initial seed policy. Any custom thresholds can be changed later through the policy UI.

## Milestone 5 — Approval workflow and status machine

Status: Planned

### Objective

Turn a validated invoice into an approval-controlled payment request with idempotent, auditable transitions.

### Work to build

- Implement statuses:
  - `DRAFT`
  - `EXTRACTED`
  - `REVIEW_REQUIRED`
  - `APPROVED`
  - `QUOTE_REQUESTED`
  - `QUOTE_READY`
  - `PAYMENT_PENDING`
  - `PAID`
  - `REJECTED`
  - `BLOCKED`
  - `EXPIRED`
  - `REFUNDED`
  - `FAILED`
- Add submitter, reviewer, and treasury administrator demo roles.
- Add approve/reject actions with reviewer, timestamp, decision, and reason.
- Prevent blocked requests from being approved through the normal UI.
- Prevent rejected requests from proceeding without explicit resubmission.
- Prevent self-approval unless the demo policy explicitly allows it.
- Show the NEAR treasury account and access-key permission scope associated with an approval identity; this is metadata only and never a private key.
- Add idempotency handling for approval actions.
- Create an audit event for every transition.

### Completion checks

- The normal invoice-to-review-to-approval path works end-to-end.
- Invalid transitions are rejected with consistent errors.
- Repeating the same approval request does not create duplicate approvals.
- Blocked, rejected, and self-approval cases are covered by tests.
- Reviewer UI shows fields, risk reasons, policy reasons, and next actions.

### Input needed from you

None. The default demo roles and policy determine the initial behavior.

## Milestone 6 — Payment quote and settlement adapters

Status: Planned

### Objective

Connect approved requests to a safe payment abstraction and simulate settlement without implying that mock activity is on-chain.

### Work to build

- Define `PaymentRail` and payment status types.
- Implement `MockPaymentRail` with deterministic success, failure, refund, and expiry scenarios.
- Implement NEAR Intents / 1Click adapter for dry quotes when configured. This adapter is required for hackathon readiness when credentials are configured; it must never imply that a dry quote settled funds.
- Keep credentials on the server.
- Keep real execution disabled by default.
- Never pretend that a fake testnet swap is real.
- Document and display the meta-transaction design: the user authorizes an intent, a relayer/sponsor may cover gas, the server never receives a full-access private key, and the demo can stop before execution.
- Store quote IDs, source/destination assets and chains, received amount, slippage, expiry, refund destination, deposit requirements, and provider status.
- Add visible labels for:
  - mock quote
  - real dry quote
  - real executed payment
- Add payment status page and simulation controls.

### Completion checks

- An approved invoice can generate a mock quote.
- A mock payment can transition to success, failure, refund, or expiry.
- Payment creation is idempotent.
- Real execution remains disabled unless explicitly configured.
- NEAR Intents adapter tests use fixtures and do not call the external service by default.
- A configured NEAR Intents dry quote can be demonstrated with provider status, expiry, refund destination, and deposit requirements.
- The payment UI contains a visible meta-transaction explanation and identifies whether the quote is mock or real-dry.

### Input needed from you

- None for mock mode.
- Optional during ordinary development, but required for final integration verification if the hackathon environment provides credentials: NEAR Intents / 1Click API URL and JWT configured locally. A normal Intents testnet should not be assumed.

## Milestone 7 — Ledger, audit history, and CSV export

Status: Planned

### Objective

Make the workflow bookkeeper-friendly and traceable from invoice submission through simulated settlement.

### Work to build

- Add ledger page with invoice, vendor, amount, status, payment rail, quote ID, transaction hash when available, refund status, and timestamps.
- Add audit page with filterable workflow events.
- Add CSV export for ledger and audit records.
- Link payment and quote identifiers where available.
- Add dashboard aggregates for pending, approved, paid, warnings, and blocked payments.
- Add empty, loading, error, retry, and success states to each page.

### Completion checks

- A completed mock payment appears in the ledger.
- Every important workflow action appears in audit history.
- CSV output opens as a valid, bookkeeper-friendly file.
- Dashboard totals agree with stored records.
- Refund and failed-payment states remain visible in the ledger.

### Input needed from you

None. The initial CSV columns will follow the ledger fields in the product brief. Optional feedback on bookkeeping conventions can be incorporated later.

## Milestone 8 — Quality, security, and demo readiness

Status: Planned

### Objective

Prove that a new developer can run the MVP from scratch and that the complete mock workflow is reliable.

### Work to build

- Add unit tests for validation, duplicates, anomalies, risk, policies, thresholds, transitions, idempotency, currencies, chains, failures, and refunds.
- Add integration tests for upload, analysis, submission, approval, quote, simulation, ledger, audit, and CSV export.
- Add frontend tests for forms, warnings, approvals, payment status, verification, and empty/error states.
- Add one Playwright happy-path test:
  - login
  - upload sample invoice
  - analyze
  - review warnings
  - approve
  - generate quote
  - simulate payment
  - inspect ledger and audit history
- Add blocked recipient, duplicate, refund, failure, and treasury-limit scenarios.
- Remove accidental logs and scan for committed secrets.
- Verify a fresh setup from the README.
- Add a short demo script and final limitations section.
- Add a hackathon submission checklist with public-repository, reproducible-setup, demo-video, and NEAR-integration evidence requirements.
- Add a judge-facing `do X, see Y` walkthrough to the README.
- Prepare a short public demo video or screenshot sequence covering the full workflow.
- Perform a final Git history and secret scan before any public push.

### Completion checks

- Full test suite, typecheck, lint, and builds pass.
- Default mock-mode demo works with no credentials.
- NEAR AI Cloud extraction works when configured, with provider and verification state visible.
- NEAR Intents dry quote works when configured, with mock/live-dry labels visible.
- Treasury account and access-key permission metadata is visible without exposing private keys.
- The meta-transaction design is documented in the README and visible in the payment flow.
- No real payment is executed accidentally.
- README accurately labels real, mocked, experimental, and out-of-scope behavior.

### Input needed from you

- None for the mock-mode completion review.
- Local credentials are required for final real-adapter verification if we want to claim those integrations in the submission. They must be provided through local environment variables only.
- Before any deployment, publication, mainnet interaction, or external submission, explicit approval will be required.
- Final submission input: team lead/name, team size, email, selected track(s), NEAR wallet payout address, and approval to publish the repository and demo post.

## What will not be built in the first MVP

These are intentional exclusions and are not submission blockers as long as the required working prototype and NEAR integrations above are demonstrated:

- Mainnet payment execution by default.
- Full wallet authentication or full-access private-key storage.
- Chain Signatures.
- Enterprise accounting integrations.
- Real personal or financial documents.
- Agent API or OutLayer as a required dependency.
- A fake NEAR Intents testnet.

## Hackathon readiness gate

Before calling Covendro submission-ready, all of the following must be true:

1. A judge can create the database, start the app, and run the complete mock workflow from the README.
2. The public demo shows invoice upload, extraction, anomaly/risk review, policy approval, quote generation, simulated settlement, ledger, and audit history.
3. The NEAR AI Cloud adapter is implemented and tested with a configured endpoint, or the README clearly records why credentials were unavailable and shows the adapter path plus deterministic fallback.
4. The NEAR Intents/1Click adapter is implemented and tested with a real dry quote when configured, or the README clearly records why credentials were unavailable and shows the adapter path plus deterministic mock fallback.
5. The UI labels `MOCKED`, `UNVERIFIED`, `VERIFIED`, real dry quote, and simulated payment states accurately.
6. The treasury model shows a NEAR account and access-key permission scope without storing private keys.
7. The payment page explains meta-transactions, relayers, gas sponsorship, and the fact that no real execution occurs by default.
8. No fake testnet transaction, unverifiable AI attestation, secret, or real personal financial document is included.

## Current checkpoint

Milestones 0, 1, and 2 are complete and validated. The next implementation step is Milestone 3: private AI abstraction, anomaly detection, and verification states. The submission-critical NEAR integration work is scheduled in Milestones 3, 5, 6, and 8 and will be treated as a release gate rather than optional polish. The repository is not submission-ready until the compliance checklist above is complete.
