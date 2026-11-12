# Covendro — Private Payables & Treasury OS

Covendro is a private accounts-payable and treasury safety system for crypto-native organizations.

## Status

The complete mock-mode vertical slice is implemented and tested. The repository contains a Next.js frontend, Fastify API, Prisma/SQLite persistence, JSON/text/PDF invoice intake, deterministic risk and policy controls, server-only NEAR AI Cloud and NEAR Intents adapters, approval workflow, payment simulation, ledger projection, audit history, CSV export, and dashboard reporting.

## Product walkthrough

The MVP vertical slice is designed to move a payable through:

```text
invoice upload → private extraction → verification → vendor risk → policy approval
→ NEAR Intents quote → simulated settlement → ledger and audit history
```

The default development mode is safe mock mode. It does not require external credentials, does not execute real payments, and does not store private keys.

## Concrete use case

A Web3 infrastructure startup is preparing to pay a 7,500 USDC invoice from an external smart-contract security firm. The invoice is syntactically valid, but the wallet address differs from the firm's payment history and the amount exceeds the startup's approval threshold. A spreadsheet can record the payment; it cannot reliably enforce the decision.

Covendro turns that risky payable into a controlled decision:

- extracts the invoice fields through a server-side AI provider without retaining the original document;
- detects the recipient change and threshold breach;
- evaluates deterministic vendor-risk and treasury-policy rules independently from the model;
- blocks silent auto-payment and routes the request to a reviewer;
- generates a NEAR Intents/1Click dry quote only after approval; and
- records the evidence, decision, quote, and settlement outcome in an audit-ready ledger.

The studio gets a clear answer—`WARN`, reviewer approval required—before any funds can move. In the default configuration, settlement is simulated, so the complete control flow can be demonstrated without risking real assets.

## Architecture

```text
Next.js web app (`apps/web`)
  └── workflow screens, status panels, demo role switcher

Fastify API (`apps/api`)
  ├── REST routes, Zod validation, request IDs
  ├── workflow state machine and idempotency
  ├── vendor risk, treasury policy, approvals, ledger, audit
  └── server-only AI and payment rail adapters

Shared package (packages/shared)
  └── domain types and validation contracts

SQLite + Prisma
  └── invoices, vendors, policies, approvals, payments, ledger, audit events
```

Trust boundaries are explicit: invoice documents are processed transiently, credentials remain in the API process, AI output is advisory, deterministic policy/risk controls make payment decisions, and a quote is never treated as settlement.

## Local setup

Requirements: Node.js 20+ and npm 10+.

```bash
cp .env.example .env
npm install
npm run db:setup
npm run typecheck
npm test
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) for the web shell. The API health endpoint is available at [http://localhost:4000/health](http://localhost:4000/health).

## Environment variables

See `.env.example`. No external credential is required for the default demo. `NEAR_AI_CLOUD_API_KEY` and `NEAR_INTENTS_JWT` are optional and will only be used by their adapters when configured. Real payment execution remains disabled by default with `REAL_PAYMENTS_ENABLED=false`.

`npm run db:migrate` applies the checked-in SQLite migration deterministically for local setup. `npm run db:migrate:prisma` is also available for environments where Prisma's migration engine is working normally.

## Private AI and verification

Invoice documents are processed transiently. The API persists the file hash, extracted invoice fields, AI provider/model metadata, confidence, opaque request ID, analysis timestamp, anomaly results, and verification state; it does not persist the original document content. The mock provider is explicitly labelled `MOCKED`. A configured NEAR AI Cloud response is labelled `UNVERIFIED` until attestation or response-signature verification succeeds. The application must not claim that an AI result is verified or that a payment is on-chain unless the corresponding integration succeeds.

Run analysis for an existing invoice with:

```bash
curl -X POST http://localhost:4000/api/invoices/<INVOICE_ID>/analyze \
  -H 'x-demo-user-email: submitter@covendro.local'
```

When `NEAR_AI_CLOUD_API_KEY` is absent, this uses `MockInvoiceAIProvider`. When it is present, the API selects `NearAICloudProvider`; the key never reaches the browser. The UI shows provider, model, confidence, request ID, verification state, and anomaly reasons.

## Judge walkthrough

From a clean checkout:

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

Open `http://localhost:3000` and:

1. Select **Invoices → New invoice** and load `sample-invoice-001.json`.
   - See fictional fixture data and the document-retention boundary.
2. Save the draft and select **Analyze invoice**.
   - See `MockInvoiceAIProvider`, `MOCKED`, confidence, anomaly signals, vendor risk, and policy reasons.
3. Select **Submit for review**, then **Approve as reviewer**.
   - See `REVIEW_REQUIRED → APPROVED`, the reviewer record, and audit events.
4. Select **Generate payment quote**.
   - See `MOCK` quote mode, source/destination assets, expiry, refund destination, and the meta-transaction design note.
5. Select **Simulate success**.
   - See `PAYMENT_PENDING → PAID`, an explicitly simulated outcome, and a mock transaction reference.
6. Open **Ledger** and **Audit**.
   - See the ledger projection, quote mode, settlement status, actor/request context, and CSV export links.

Safety scenarios include suspicious amounts, duplicate invoices, blocked recipients, treasury freeze, refunds, and failed payments. The UI labels `MOCKED`, `MOCK`, real dry quotes, and simulated settlement states explicitly.

## Testing commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run security:scan
# run all local release checks
npm run verify

# run the isolated browser workflow
npm run e2e
```

## Limitations

- Full wallet authentication is not implemented; the MVP uses seeded demo identities and role headers.
- No real payment is executed by this project in its default configuration.
- NEAR Intents has no normal testnet; development will use dry quotes or an explicitly labelled mock adapter.
- Chain Signatures and experimental Agent API/OutLayer integrations are out of scope for the first MVP.
- PDF parsing extracts text-based PDFs; scanned/image-only PDFs require manual entry or later OCR support.
- Playwright browser automation is included in `npm run e2e`; it runs against an isolated fresh SQLite database and does not require credentials.

## Treasury risk and policy controls

Vendor risk is deterministic and independent from AI. The policy engine evaluates the active recipient allowlist, supported currency and chain, per-transaction and daily limits, approval threshold, warning behavior, treasury freeze, and demo mode. Decisions are returned as `ALLOW`, `WARN`, or `BLOCK` with reasons and are persisted on analyzed invoices. The policy screen also shows the seeded NEAR treasury account and limited function-call access-key scope; this is metadata only, with no private key or transfer authority.

The demo administrator can use `/treasury-policy` to create a new policy version or freeze/unfreeze the treasury. The `/vendors` page shows recipient allowlist and risk state. Policy updates, freezes, vendor assessments, and policy evaluations are written to the audit stream.

## Payment quotes and settlement simulation

Approved invoices can request a quote through `POST /api/invoices/:id/quote`. Without NEAR Intents credentials, the API uses `MockPaymentRail` and labels the result `MOCK`. With `NEAR_INTENTS_JWT`, `NEAR_INTENTS_ORIGIN_ASSET_ID`, and `NEAR_INTENTS_DESTINATION_ASSET_ID` configured, it uses the server-only 1Click adapter and labels a dry response `REAL_DRY`. `REAL_PAYMENTS_ENABLED=false` and `NEAR_INTENTS_DRY_RUN=true` keep execution disabled by default.

To verify both live adapters without exposing credentials, copy the optional variables from `.env.example` into an uncommitted local `.env`, then run `npm run verify:near`. The command sends fictional invoice data to NEAR AI Cloud, checks structured extraction/anomaly responses and request IDs, queries the live 1Click token catalog, and requests a forced `dry: true` quote. It prints only provider metadata and presence checks; it never prints API keys/JWTs or executes a payment. A real 1Click quote requires a valid `NEAR_INTENTS_TEST_RECIPIENT` matching the configured destination chain.

The live verification path has been exercised locally. The NEAR AI Cloud adapter returned extraction and anomaly results using `google/gemini-2.5-flash-lite`; its status is intentionally `UNVERIFIED` because attestation/signature verification is not implemented. The NEAR Intents adapter returned a real dry quote with status `PENDING_DEPOSIT`; no funds were deposited and no payment was executed.

The `/payments` pages show quote mode, provider status, deposit requirements, expiry, refund destination, and meta-transaction design. Only mock quotes expose local success/refund/failure/expiry simulation controls. A real dry quote is a quote preview and never a settled payment.

The payment design supports a future relayer/meta-transaction path so users do not need to manually acquire NEAR gas. That path is documented and visible, but no real relayer or payment execution is enabled in this MVP.

## Ledger, audit, and reporting

The `/ledger` page is backed by `LedgerEntry` records synchronized from quote and settlement transitions. The `/audit` page exposes workflow events with actors, invoices, payments, and request IDs. Ledger and audit records can be exported from `/api/ledger.csv` and `/api/audit-events.csv`. The dashboard reads `/api/dashboard` for pending, approved, paid, warning, blocked, policy, and recent-activity aggregates.

## Approval workflow

An analyzed invoice can be submitted by its creator, reviewed by the seeded reviewer, approved or rejected with a reason, and explicitly resubmitted after rejection. Blocked invoices cannot be approved. Approval actions support idempotency keys and preserve prior decisions across approval rounds. The invoice detail page shows the next action, risk/policy reasons, approval records, and audit history.

## Conclusion

Covendro provides a controlled payment path for crypto-native organizations: private invoice processing, deterministic treasury controls, explicit reviewer approval, cross-chain quote visibility, and an audit-ready record of what happened. The default configuration is safe for demos and local development, while the NEAR AI Cloud and NEAR Intents adapters provide clear integration paths when credentials are configured.
