# Mainnet pilot operations

## Provision staging and production

Use separate HTTPS web and API origins on the same site, a persistent reconciliation worker, and managed PostgreSQL. Keep the demo database and demo credentials separate. The API and worker use the same API image and pilot database. The web image receives only the public API base at build time.

```sh
docker build --target api -t covendro-api .
docker build --target web --build-arg NEXT_PUBLIC_API_URL=https://api.example.org -t covendro-web .
```

Run the API image once with `npx prisma migrate deploy --schema prisma/postgresql/schema.prisma` before rolling out the API and worker. Run the worker with `npm run reconcile --workspace @covendro/api`. Inject the PostgreSQL URL, exact web origin, and provider and RPC credentials from the host's secret store. Keep `PILOT_ENABLE_WALLET_HANDOFF=false` during staging and until the canary setup is complete. Use hosting access controls and a new database without demo seed data.

## Validate the route and workspace

The public 1Click catalog lists 6-decimal native USDC for the proposed route. The NEAR contract is `17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1`. The Base contract is `0x833589fcd6edb6e08f4c7c32d4f71b54bda02913`. Verify them again through the live pilot configuration before enabling the route. [1Click supported assets](https://docs.agentsonintents.com/resources/asset-support) Confirm the Base payout sender and NEAR refund sender with the provider and check the signed quote/status envelope, actual gas and fee amounts, deposit registration, liquidity, minimums, and refund transaction form. The worker currently matches a direct finalized NEP-141 refund and sends ambiguous, partial, or unrecognized cases to the queue.

Bootstrap the pilot organization, dedicated customer-controlled NEAR treasury, members, and initial policy. Set the pilot workspace slug, maximum debit, daily limit, approved vendor destination, and separately agreed canary amount. Verify the wallet and its proof callback on the hosted HTTPS site. Keep document intake manual until approved AI processing and attestation are available.

## Monitor and recover

Alert on queue age, overdue checks, repeated failures and evidence mismatches. Assign a primary and backup operator. Freeze new handoffs from the treasury policy page during an incident and keep the worker running. Inspect the provider and finalized chain receipts before changing an exception. Closing the wallet, missing callbacks, and quote expiry do not release an exposed debit. A restore or rollback must preserve active attempts, the unique funding and payout references, and audit history. Reconcile known attempts again after restore.

The canary signer reviews and approves the exact wallet action. Check one finalized NEAR debit, one verified Base delivery, and matching invoice, ledger, and audit records. Rehearse a provider-approved refund and late-deposit case before expanding access. Review the first ten funded attempts before raising any limit or adding a route.
