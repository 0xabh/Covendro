# Covendro — Private Payables & Treasury OS

Private payables and treasury infrastructure for crypto-native companies, DAOs, agencies, and distributed teams in the NEAR ecosystem.

## Status

Milestones 0, 1, and 2 are complete. The repository now contains a runnable Next.js web shell, a Fastify API, a Prisma/SQLite domain schema, seeded demo data, repository access, JSON/text/PDF invoice intake, validation, duplicate detection, and a deterministic test setup. The invoice-to-payment workflow is being built incrementally.

## Product walkthrough

The MVP vertical slice is designed to move a payable through:

```text
invoice upload → private extraction → verification → vendor risk → policy approval
→ NEAR Intents quote → simulated settlement → ledger and audit history
```

The default development mode is safe mock mode. It does not require external credentials, does not execute real payments, and does not store private keys.

## Architecture

```text
Next.js web app (apps/web)
  └── workflow screens, status panels, demo role switcher

Fastify API (apps/api)
  ├── REST routes and request IDs
  ├── domain services and policy engine
  ├── mock adapters for AI and payments
  └── optional NEAR AI Cloud and NEAR Intents adapters

Shared package (packages/shared)
  └── domain types and validation contracts

SQLite + Prisma (Milestone 1)
  └── invoices, vendors, policies, approvals, payments, ledger, audit events
```

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

## Privacy and integration boundaries

The current scaffold does not process invoice documents yet. Future milestones will retain only hashes, extracted fields, provider metadata, and verification state; original documents will be temporary. The application must not claim that an AI result is verified or that a payment is on-chain unless the corresponding integration succeeds.

## Planned milestones

0. Repository and architecture scaffold — complete.
1. Prisma schema, SQLite database, seed data, and repositories — complete.
2. Invoice upload, validation, fixtures, and duplicate detection — complete.
3. Mock and NEAR AI Cloud extraction with verification states — next.
4. Vendor risk and treasury policy engine.
5. Approval workflow and audit transitions.
6. Mock payment rail and optional NEAR Intents dry quotes.
7. Ledger, CSV export, full tests, and demo readiness.

The detailed step-by-step implementation plan, completion checks, and required inputs are documented in [`docs/MVP_BUILD_PLAN.md`](docs/MVP_BUILD_PLAN.md).

## Testing commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

## Limitations

- Authentication is not implemented yet; demo roles are planned for a later milestone.
- No real payment is executed by this project in its default configuration.
- NEAR Intents has no normal testnet; development will use dry quotes or an explicitly labelled mock adapter.
- Chain Signatures and experimental Agent API/OutLayer integrations are out of scope for the first MVP.
- PDF parsing extracts text-based PDFs; scanned/image-only PDFs require manual entry or later OCR support.
