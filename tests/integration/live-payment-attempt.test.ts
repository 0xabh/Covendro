import { reconcileDuePayments } from "../../apps/api/src/services/payments/reconciliation-worker.js";
import { expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { prisma } from "../../apps/api/src/db/prisma.js";
import { treasuryProofBinding } from "../../apps/api/src/services/treasury-proof.js";
import { credentialDigest, generateCredential } from "../../apps/api/src/services/workspace-access.js";

vi.mock("@defuse-protocol/one-click-sdk-typescript", async (importOriginal) => ({
  ...await importOriginal<typeof import("@defuse-protocol/one-click-sdk-typescript")>(),
  verifyQuoteSignature: vi.fn((quote: { signature: string }) => quote.signature === "fixture-verified"),
}));

it.each(["settlement", "refund"] as const)("holds the reserved debit and reconciles %s only with final evidence", async (outcome) => {
  const webOrigin = "https://pilot.example";
  const recipient = "0x1111111111111111111111111111111111111111";
  const baseUsdc = "0x2222222222222222222222222222222222222222";
  const sourceContract = "usdc.near";
  const slug = "live-attempt-tests";
  const env = {
    WEB_ORIGIN: webOrigin, DEMO_MODE: "false", PILOT_LIVE_WORKSPACE_SLUG: slug,
    PILOT_MAX_DEBIT_MINOR: "500", PILOT_NEAR_USDC_CONTRACT: sourceContract,
    PILOT_BASE_USDC_CONTRACT: baseUsdc, NEAR_INTENTS_ORIGIN_ASSET_ID: "near-usdc",
    NEAR_INTENTS_DESTINATION_ASSET_ID: "base-usdc",
    NEAR_TREASURY_RPC_URL: "https://rpc.example", BASE_MAINNET_RPC_URL: "https://base.example",
    PILOT_BASE_PAYOUT_SENDER: "0x3333333333333333333333333333333333333333",
  };
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  vi.stubEnv("NEAR_INTENTS_API_KEY", generateCredential());
  vi.stubEnv("PILOT_ENABLE_WALLET_HANDOFF", "false");
  vi.stubEnv("PILOT_NEAR_REFUND_SENDER", "refund.near");
  const token = generateCredential();
  const reviewerToken = generateCredential();
  const sessionDigest = credentialDigest(token);
  const expiresAt = new Date(Date.now() + 120_000);
  const headers = { origin: webOrigin, cookie: `__Host-covendro=${token}` };
  const app = buildApp();
  const organization = await prisma.organization.create({ data: {
    slug, name: "Pilot",
    users: { create: [
      { name: "Submitter", email: "submitter@live-test.example", role: "SUBMITTER" },
      { name: "Reviewer", email: "reviewer@live-test.example", role: "REVIEWER",
        workspaceCredentials: { create: { digest: credentialDigest(reviewerToken), purpose: "SESSION", expiresAt } } },
      { name: "Signer", email: "signer@live-test.example", role: "TREASURY_SIGNER",
        workspaceCredentials: { create: { digest: sessionDigest, purpose: "SESSION", expiresAt } } },
    ] },
    policies: { create: {
      version: 1, maxPaymentPerTransactionMinor: 600, maxDailyPaymentTotalMinor: 800,
      allowedCurrenciesCsv: "USDC", allowedChainsCsv: "base", allowedRecipientsCsv: recipient,
      requireApprovalAboveMinor: 50, demoMode: false,
    } },
    treasuryIdentities: { create: {
      nearAccountId: "treasury.near", name: "Treasury", keyPurpose: "QUOTE_REFUND_DESTINATION",
      accessKeyPermissionScope: "External wallet", keyType: "UNVERIFIED", demoIdentity: false,
    } },
  }, include: { users: true, treasuryIdentities: true, policies: true } });

  const txHash = "11111111111111111111111111111111";
  const refundHash = "22222222222222222222222222222222";
  let wrongEvidence = true;
  let quoteCount = 0;
  let validSignature = false;
  let providerAvailable = false;
  let payoutFinalized = false;
  let firstValidQuote: object | undefined;
  const payoutHash = "0x" + "b".repeat(64);
  const payoutBlock = "0x" + "c".repeat(64);
  const mockFetch = vi.fn<typeof fetch>(async (url, request) => {
    if (String(url).endsWith("/tokens")) return Response.json([
      { assetId: "near-usdc", contractAddress: sourceContract, blockchain: "near", decimals: 6, symbol: "USDC" },
      { assetId: "base-usdc", contractAddress: baseUsdc, blockchain: "base", decimals: 6, symbol: "USDC" },
    ]);
    if (String(url).includes("/status?")) {
      expect(new URL(String(url)).searchParams.get("depositMemo")).toBe("memo");
      if (!providerAvailable) return Response.json({}, { status: 503 });
      if (outcome === "refund") return Response.json({ status: "REFUNDED", quoteResponse: firstValidQuote, swapDetails: {
        depositedAmount: "5000000", refundedAmount: "4990000", nearTxHashes: [refundHash],
        originChainTxHashes: [{ hash: txHash }],
      } });
      return Response.json({ status: "SUCCESS", quoteResponse: firstValidQuote, swapDetails: {
        amountIn: "5000000", depositedAmount: "5000000", refundedAmount: "0",
        originChainTxHashes: [{ hash: txHash }], destinationChainTxHashes: [{ hash: payoutHash }],
      } });
    }
    const body = JSON.parse(String(request?.body));
    if (String(url) === "https://base.example") {
      if (body.method === "eth_chainId") return Response.json({ result: "0x2105" });
      if (body.method === "eth_getBlockByNumber") return Response.json({ result: {
        number: payoutFinalized ? "0xa" : "0x9", hash: payoutBlock,
      } });
      return Response.json({ result: {
        transactionHash: payoutHash, blockNumber: "0xa", blockHash: payoutBlock, status: "0x1",
        logs: [{ address: baseUsdc, data: "0x" + (4_000_000).toString(16).padStart(64, "0"), topics: [
          "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
          "0x" + env.PILOT_BASE_PAYOUT_SENDER.slice(2).padStart(64, "0"),
          "0x" + recipient.slice(2).padStart(64, "0"),
        ] }],
      } });
    }
    if (String(url).endsWith("/quote")) {
      const response = {
      signature: validSignature ? "fixture-verified" : "invalid",
      timestamp: new Date().toISOString(), quoteRequest: body,
      quote: {
        amountIn: "5000000", minAmountIn: "4950000", amountOut: body.amount, minAmountOut: body.amount,
        depositAddress: `deposit-${++quoteCount}.near`, depositMemo: "memo",
        deadline: body.deadline, refundFee: "10000", withdrawFee: "10000",
      },
      };
      if (validSignature) firstValidQuote ??= response;
      return Response.json(response);
    }
    if (body.method === "status") return Response.json({ result: { chain_id: "mainnet" } });
    if (body.method === "tx" && body.params.tx_hash === refundHash) {
      if (!payoutFinalized) return Response.json({ result: { final_execution_status: "EXECUTED" } });
      const transfer = { receiver_id: "treasury.near", amount: "4990000" };
      return Response.json({ result: {
        final_execution_status: "FINAL", status: { SuccessValue: "" },
        transaction: { hash: refundHash, signer_id: "refund.near", receiver_id: sourceContract,
          actions: [{ FunctionCall: { method_name: "ft_transfer", deposit: "1", args: Buffer.from(JSON.stringify(transfer)).toString("base64") } }] },
        receipts_outcome: [{ id: "refund-receipt", block_hash: "refund-block", outcome: {
          executor_id: sourceContract, status: { SuccessValue: "" },
          logs: ["EVENT_JSON:" + JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer",
            data: [{ old_owner_id: "refund.near", new_owner_id: transfer.receiver_id, amount: transfer.amount }],
          })],
        } }],
      } });
    }
    if (body.method === "tx") {
      const transfer = { receiver_id: "deposit-2.near", amount: "5000000", memo: "memo" };
      return Response.json({ result: {
        final_execution_status: "FINAL", status: { SuccessValue: "" },
        transaction: { hash: txHash, signer_id: "treasury.near", receiver_id: sourceContract,
          actions: [{ FunctionCall: { method_name: "ft_transfer", deposit: "1", args: Buffer.from(JSON.stringify(transfer)).toString("base64") } }] },
        receipts_outcome: [{ id: "receipt", block_hash: "block", outcome: {
          executor_id: sourceContract, status: { SuccessValue: "" },
          logs: ["EVENT_JSON:" + JSON.stringify({ standard: "nep141", version: "1.0.0", event: "ft_transfer",
            data: [{ old_owner_id: "treasury.near", new_owner_id: transfer.receiver_id, amount: wrongEvidence ? "10" : transfer.amount, memo: "memo" }],
          })],
        } }],
      } });
    }
    if (body.params.request_type === "view_access_key") return Response.json({ result: { permission: "FullAccess" } });
    if (body.params.request_type === "view_account") return Response.json({ result: { amount: "1000000000000000000000000" } });
    const result = body.params.method_name === "ft_balance_of" ? "10000000" : { total: "100", available: "0" };
    return Response.json({ result: { result: [...Buffer.from(JSON.stringify(result))] } });
  });
  vi.stubGlobal("fetch", mockFetch);

  try {
    const submitter = organization.users.find((user) => user.role === "SUBMITTER")!;
    const reviewer = organization.users.find((user) => user.role === "REVIEWER")!;
    const signer = organization.users.find((user) => user.role === "TREASURY_SIGNER")!;
    const vendor = await prisma.vendor.create({ data: {
      name: "Vendor", accountAddress: recipient, accountChain: "base", allowlisted: true, organizationId: organization.id,
      destinations: { create: { chain: "base", address: recipient, proposedById: submitter.id, verifiedById: reviewer.id, verifiedAt: new Date() } },
    } });
    const invoices = [];
    for (const invoiceNumber of ["firm-one", "firm-two"]) {
      const invoice = await prisma.invoice.create({ data: {
        invoiceNumber, organizationId: organization.id, vendorId: vendor.id, createdById: submitter.id,
        status: "REVIEW_REQUIRED", currency: "USDC", amountMinor: 400, invoiceDate: new Date(),
        paymentDestination: recipient, paymentChain: "base", verificationState: "HUMAN_VERIFIED",
      } });
      const reviewerHeaders = { origin: webOrigin, cookie: `__Host-covendro=${reviewerToken}` };
      const terms = await app.inject({ method: "GET", url: `/api/invoices/${invoice.id}/payable-terms`, headers: reviewerHeaders });
      expect(terms.json().data.terms.maxAuthorizedDebitMinor).toBe(500);
      const approve = { method: "POST" as const, url: `/api/invoices/${invoice.id}/approve`, headers: reviewerHeaders };
      expect((await app.inject({ ...approve, payload: { termsHash: "stale" } })).json().error.code).toBe("APPROVAL_TERMS_CHANGED");
      const approved = await app.inject({ ...approve, payload: { termsHash: terms.json().data.termsHash } });
      expect(approved.json().data.invoice.status).toBe("APPROVED");
      expect(await prisma.approval.count({ where: { invoiceId: invoice.id, reviewerId: reviewer.id } })).toBe(1);
      invoices.push(invoice);
    }
    const prepare = (invoiceId: string) => app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/live-attempt`, headers });
    const handoff = (attemptId: string) => app.inject({ method: "POST", url: `/api/live-attempts/${attemptId}/wallet-handoff`, headers });

    expect((await prepare(invoices[0].id)).json().error.code).toBe("LIVE_QUOTE_SIGNATURE_INVALID");
    validSignature = true;
    const first = await prepare(invoices[0].id);
    expect(first.statusCode).toBe(200);
    const attempt = first.json().data;
    expect(attempt).toMatchObject({ status: "PREPARED", originDebitAtomic: "5000000", destinationAmountAtomic: "4000000" });
    expect(attempt).not.toHaveProperty("depositAccountId");
    expect((await prepare(invoices[0].id)).json().data.id).toBe(attempt.id);
    expect((await handoff(attempt.id)).json().error.code).toBe("WALLET_HANDOFF_DISABLED");

    vi.stubEnv("PILOT_ENABLE_WALLET_HANDOFF", "true");
    expect((await handoff(attempt.id)).json().error.code).toBe("TREASURY_PROOF_REQUIRED");
    await prisma.workspaceCredential.create({ data: {
      digest: credentialDigest("verified-proof"), userId: signer.id, expiresAt,
      purpose: treasuryProofBinding(organization.treasuryIdentities[0].id, sessionDigest) + "ed25519:fixture-key",
    } });
    await prisma.treasuryPolicy.update({ where: { id: organization.policies[0].id }, data: { freezePayments: true } });
    expect((await handoff(attempt.id)).json().error.code).toBe("PAYMENT_BLOCKED");
    await prisma.treasuryPolicy.update({ where: { id: organization.policies[0].id }, data: { freezePayments: false } });

    const funded = await handoff(attempt.id);
    expect(funded.statusCode).toBe(200);
    expect(funded.json().data.walletRequest).toMatchObject({
      signerId: "treasury.near", network: "mainnet", receiverId: sourceContract,
      actions: [{ type: "FunctionCall", params: { methodName: "ft_transfer",
        args: { receiver_id: "deposit-2.near", amount: "5000000", memo: "memo" }, deposit: "1" } }],
    });
    expect((await handoff(attempt.id)).json().error.code).toBe("WALLET_HANDOFF_ALREADY_ISSUED");
    await prisma.livePaymentAttempt.update({ where: { id: attempt.id }, data: { reservationDay: "2020-01-01" } });
    const second = await prepare(invoices[1].id);
    expect(second.statusCode).toBe(200);
    expect((await handoff(second.json().data.id)).json().error.code).toBe("DAILY_SPEND_LIMIT_EXCEEDED");
    const confirm = () => app.inject({ method: "POST", url: `/api/live-attempts/${attempt.id}/funding`, headers, payload: { txHash } });
    expect((await confirm()).json().error.code).toBe("FUNDING_EVIDENCE_MISMATCH");
    wrongEvidence = false;
    expect((await confirm()).json().data).toMatchObject({ status: "FUNDING_CONFIRMED", fundingTxHash: txHash });
    expect((await confirm()).json().data).toMatchObject({ status: "FUNDING_CONFIRMED", fundingTxHash: txHash });
    expect(await prisma.auditEvent.count({ where: { invoiceId: invoices[0].id, eventType: "LIVE_ORIGIN_FUNDING_CONFIRMED" } })).toBe(1);
    expect(await prisma.livePaymentAttempt.count({ where: { organizationId: organization.id, handedOffAt: { not: null } } })).toBe(1);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoices[0].id } })).status).toBe("PAYMENT_PENDING");
    await reconcileDuePayments();
    expect(await prisma.livePaymentAttempt.findUnique({ where: { id: attempt.id } })).toMatchObject({ reconcileIssue: "PROVIDER_STATUS_UNAVAILABLE", checkFailures: 1 });
    providerAvailable = true;
    await prisma.livePaymentAttempt.update({ where: { id: attempt.id }, data: { nextCheckAt: new Date(0) } });
    await reconcileDuePayments();
    expect(await prisma.livePaymentAttempt.findUnique({ where: { id: attempt.id } })).toMatchObject({ reconcileIssue: outcome === "settlement" ? "BASE_PAYOUT_NOT_FINAL" : "FUNDING_NOT_VERIFIED" });
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: invoices[0].id } })).status).toBe("PAYMENT_PENDING");
    payoutFinalized = true;
    await prisma.livePaymentAttempt.update({ where: { id: attempt.id }, data: { nextCheckAt: new Date(0) } });
    await reconcileDuePayments();
    await reconcileDuePayments();
    expect(await prisma.livePaymentAttempt.findUnique({ where: { id: attempt.id } })).toMatchObject({
      ...(outcome === "settlement" ? { status: "SETTLED", destinationTxHash: payoutHash } : {
        status: "REFUNDED", refundTxHash: refundHash, refundedAtomic: "4990000",
      }), activeInvoiceId: null, nextCheckAt: null,
    });
    expect(await prisma.ledgerEntry.findUnique({ where: { invoiceId: invoices[0].id } })).toMatchObject({ paymentStatus: outcome === "settlement" ? "PAID" : "REFUNDED", transactionHash: txHash });
    expect(await prisma.auditEvent.count({ where: { invoiceId: invoices[0].id, eventType: outcome === "settlement" ? "LIVE_BASE_DELIVERY_VERIFIED" : "LIVE_NEAR_REFUND_VERIFIED" } })).toBe(1);
    const ledger = await app.inject({ method: "GET", url: "/api/ledger.csv", headers });
    expect(ledger.body).toContain(outcome === "settlement" ? payoutHash : refundHash);

  } finally {
    await prisma.livePaymentAttempt.deleteMany({ where: { organizationId: organization.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
    await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
