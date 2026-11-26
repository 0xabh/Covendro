import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { prisma } from "../../apps/api/src/db/prisma.js";

const invoiceNumber = `NS-API-${Date.now()}`;
const body = {
  vendorName: "Northstar Design Co.",
  vendorAddress: "northstar.near",
  vendorChain: "near",
  invoiceNumber,
  invoiceDate: "2026-11-01",
  dueDate: "2026-11-15",
  currency: "USDC",
  amount: "1250.00",
  lineItems: [{ description: "Design work", quantity: "1", unitAmount: "1250.00" }],
  paymentDestination: "northstar.near",
  paymentChain: "near",
  memo: "Integration test invoice",
  sourceDocument: {
    fileName: "sample-invoice-001.json",
    fileType: "application/json",
    content: JSON.stringify({ invoiceNumber }),
  },
};

describe("invoice API", () => {
  const app = buildApp();
  let invoiceId = "";
  const createdInvoiceIds: string[] = [];

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    if (createdInvoiceIds.length) await prisma.invoice.deleteMany({ where: { id: { in: createdInvoiceIds } } });
    await app.close();
  });

  it("creates an invoice, hashes the temporary document, and records an audit event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/invoices",
      headers: { "x-demo-user-email": "submitter@covendro.local" },
      payload: body,
    });
    const result = response.json();
    invoiceId = result.data.id;
    createdInvoiceIds.push(invoiceId);

    expect(response.statusCode).toBe(201);
    expect(result.data.status).toBe("DRAFT");
    expect(result.data.amountMinor).toBe(125000);
    expect(result.data.fileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.data.lineItems).toHaveLength(1);
  });

  it("rejects a duplicate invoice number for the same vendor", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/invoices",
      headers: { "x-demo-user-email": "submitter@covendro.local" },
      payload: body,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe("DUPLICATE_INVOICE");
  });

  it("returns the created invoice detail", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/invoices/${invoiceId}`,
      headers: { "x-demo-user-email": "submitter@covendro.local" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.auditEvents[0].eventType).toBe("INVOICE_UPLOADED");
  });

  it("parses a plain-text invoice document without persisting its text", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/api/invoices/parse-document",
      payload: {
        fileName: "sample-invoice-003.txt",
        fileType: "text/plain",
        content: "Vendor Name: Northstar Design Co.\nInvoice Number: TXT-001\nAmount: 640.00\nPayment Destination: northstar.near",
      },
    });
    const result = response.json();

    expect(response.statusCode).toBe(200);
    expect(result.data.parser).toBe("PLAIN_TEXT");
    expect(result.data.fields.invoiceNumber).toBe("TXT-001");
    expect(result.data).not.toHaveProperty("originalContent");
  });

  it("analyzes an invoice with the deterministic provider and persists verification metadata", async () => {
    const response = await app.inject({
      method: "POST",
      url: `/api/invoices/${invoiceId}/analyze`,
      headers: { "x-demo-user-email": "submitter@covendro.local" },
    });
    const result = response.json();

    expect(response.statusCode).toBe(200);
    expect(result.data.invoice.status).toBe("EXTRACTED");
    expect(result.data.invoice.extractionProvider).toBe("MockInvoiceAIProvider");
    expect(result.data.invoice.verificationState).toBe("MOCKED");
    expect(result.data.invoice.anomalyResultJson).toContain("NEW_VENDOR");
    expect(result.data.invoice.vendorRiskDecision).toBe("WARN");
    expect(result.data.invoice.policyDecision).toBe("WARN");
    expect(result.data.invoice.auditEvents.map((event: { eventType: string }) => event.eventType)).toEqual(expect.arrayContaining(["AI_ANALYSIS_COMPLETED", "VENDOR_RISK_ASSESSED", "POLICY_EVALUATED"]));
  });

  it("exposes the active policy and vendor risk assessment endpoints", async () => {
    const policyResponse = await app.inject({ method: "GET", url: "/api/policies", headers: { "x-demo-user-email": "treasury@covendro.local" } });
    const vendorsResponse = await app.inject({ method: "GET", url: "/api/vendors", headers: { "x-demo-user-email": "reviewer@covendro.local" } });
    const vendorId = vendorsResponse.json().data.find((vendor: { accountAddress: string }) => vendor.accountAddress === "northstar.near").id;
    const riskResponse = await app.inject({ method: "GET", url: `/api/vendors/${vendorId}/risk?invoiceId=${invoiceId}`, headers: { "x-demo-user-email": "reviewer@covendro.local" } });

    expect(policyResponse.statusCode).toBe(200);
    expect(policyResponse.json().data.active.allowedRecipients).toContain("northstar.near");
    expect(vendorsResponse.statusCode).toBe(200);
    expect(riskResponse.statusCode).toBe(200);
    expect(riskResponse.json().data.policy.decision).toBe("WARN");
  });

  it("submits for review, prevents self-approval, and makes approval idempotent", async () => {
    const submitResponse = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/submit`, headers: { "x-demo-user-email": "submitter@covendro.local" } });
    const selfApproval = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/approve`, headers: { "x-demo-user-email": "submitter@covendro.local" } });
    await prisma.invoice.update({ where: { id: invoiceId }, data: { requiredApprovals: 2 } });
    const approval = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/approve`, headers: { "x-demo-user-email": "reviewer@covendro.local", "idempotency-key": `approval-${invoiceId}` } });
    const repeated = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/approve`, headers: { "x-demo-user-email": "reviewer@covendro.local", "idempotency-key": `approval-${invoiceId}` } });
    const secondApproval = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/approve`, headers: { "x-demo-user-email": "treasury@covendro.local" } });
    const approvals = await prisma.approval.findMany({ where: { invoiceId } });

    expect(submitResponse.statusCode).toBe(200);
    expect(submitResponse.json().data.invoice.status).toBe("REVIEW_REQUIRED");
    expect(selfApproval.statusCode).toBe(403);
    expect(["REVIEWER_ROLE_REQUIRED", "SELF_APPROVAL_NOT_ALLOWED"]).toContain(selfApproval.json().error.code);
    expect(approval.statusCode).toBe(200);
    expect(approval.json().data.invoice.status).toBe("REVIEW_REQUIRED");
    expect(secondApproval.statusCode).toBe(200);
    expect(secondApproval.json().data.invoice.status).toBe("APPROVED");
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().data.idempotent).toBe(true);
    expect(approvals).toHaveLength(2);
  });

  it("blocks a new quote when the active policy is frozen after approval", async () => {
    const invoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const policy = await prisma.treasuryPolicy.findFirstOrThrow({
      where: { organizationId: invoice.organizationId, active: true },
    });
    await prisma.treasuryPolicy.update({ where: { id: policy.id }, data: { freezePayments: true } });
    try {
      const response = await app.inject({
        method: "POST",
        url: `/api/invoices/${invoiceId}/quote`,
        headers: { "x-demo-user-email": "reviewer@covendro.local" },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json().error.code).toBe("PAYMENT_BLOCKED");
      expect(await prisma.payment.findUnique({ where: { invoiceId } })).toBeNull();
    } finally {
      await prisma.treasuryPolicy.update({ where: { id: policy.id }, data: { freezePayments: policy.freezePayments } });
    }
  });

  it("creates an idempotent mock quote and simulates successful settlement", async () => {
    const quote = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/quote`, headers: { "x-demo-user-email": "reviewer@covendro.local", "idempotency-key": `quote-${invoiceId}` } });
    const repeatedQuote = await app.inject({ method: "POST", url: `/api/invoices/${invoiceId}/quote`, headers: { "x-demo-user-email": "reviewer@covendro.local", "idempotency-key": `quote-${invoiceId}` } });
    const paymentId = quote.json().data.payment.id;
    const simulation = await app.inject({ method: "POST", url: `/api/payments/${paymentId}/simulate`, headers: { "x-demo-user-email": "reviewer@covendro.local" }, payload: { outcome: "SUCCESS" } });

    expect(quote.statusCode).toBe(200);
    expect(quote.json().data.payment.quoteMode).toBe("MOCK");
    expect(quote.json().data.payment.status).toBe("QUOTE_READY");
    expect(repeatedQuote.json().data.idempotent).toBe(true);
    expect(simulation.statusCode).toBe(200);
    expect(simulation.json().data.payment.status).toBe("PAID");
    expect(simulation.json().data.payment.invoice.status).toBe("PAID");
  });

  it("projects settlement into the ledger, dashboard, and CSV exports", async () => {
    const ledger = await app.inject({ method: "GET", url: "/api/ledger", headers: { "x-demo-user-email": "treasury@covendro.local" } });
    const ledgerCsv = await app.inject({ method: "GET", url: "/api/ledger.csv", headers: { "x-demo-user-email": "treasury@covendro.local" } });
    const auditCsv = await app.inject({ method: "GET", url: "/api/audit-events.csv", headers: { "x-demo-user-email": "treasury@covendro.local" } });
    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard", headers: { "x-demo-user-email": "treasury@covendro.local" } });

    expect(ledger.statusCode).toBe(200);
    expect(ledger.json().data.find((entry: { invoiceId: string }) => entry.invoiceId === invoiceId)).toMatchObject({ paymentStatus: "PAID", quoteMode: "MOCK" });
    expect(ledgerCsv.statusCode).toBe(200);
    expect(ledgerCsv.headers["content-type"]).toContain("text/csv");
    expect(ledgerCsv.body).toContain("invoiceNumber");
    expect(ledgerCsv.body).toContain(invoiceNumber);
    expect(auditCsv.statusCode).toBe(200);
    expect(auditCsv.body).toContain("PAYMENT_SIMULATED");
    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().data.paidAmountMinor).toBeGreaterThanOrEqual(125000);
  });

  it("requires explicit resubmission after rejection", async () => {
    const response = await app.inject({ method: "POST", url: "/api/invoices", headers: { "x-demo-user-email": "submitter@covendro.local" }, payload: { ...body, invoiceNumber: `${invoiceNumber}-REJECT`, amount: "640.00", sourceDocument: { ...body.sourceDocument, content: JSON.stringify({ invoiceNumber: `${invoiceNumber}-REJECT` }) } } });
    const rejectedInvoiceId = response.json().data.id;
    createdInvoiceIds.push(rejectedInvoiceId);
    await app.inject({ method: "POST", url: `/api/invoices/${rejectedInvoiceId}/analyze`, headers: { "x-demo-user-email": "submitter@covendro.local" } });
    await app.inject({ method: "POST", url: `/api/invoices/${rejectedInvoiceId}/submit`, headers: { "x-demo-user-email": "submitter@covendro.local" } });
    const rejection = await app.inject({ method: "POST", url: `/api/invoices/${rejectedInvoiceId}/reject`, headers: { "x-demo-user-email": "reviewer@covendro.local", "idempotency-key": `reject-${rejectedInvoiceId}` }, payload: { reason: "Vendor details need confirmation" } });
    const invalidSubmit = await app.inject({ method: "POST", url: `/api/invoices/${rejectedInvoiceId}/submit`, headers: { "x-demo-user-email": "submitter@covendro.local" } });
    const resubmission = await app.inject({ method: "POST", url: `/api/invoices/${rejectedInvoiceId}/resubmit`, headers: { "x-demo-user-email": "submitter@covendro.local" } });

    expect(rejection.statusCode).toBe(200);
    expect(rejection.json().data.invoice.status).toBe("REJECTED");
    expect(invalidSubmit.statusCode).toBe(409);
    expect(invalidSubmit.json().error.code).toBe("RESUBMIT_REQUIRED");
    expect(resubmission.statusCode).toBe(200);
    expect(resubmission.json().data.invoice.status).toBe("REVIEW_REQUIRED");
  });

  it("blocks a policy-violating request before approval", async () => {
    const response = await app.inject({ method: "POST", url: "/api/invoices", headers: { "x-demo-user-email": "submitter@covendro.local" }, payload: { ...body, vendorName: "Harbor Data Services", vendorAddress: "0x1111111111111111111111111111111111111111", vendorChain: "ethereum", paymentDestination: "0x1111111111111111111111111111111111111111", paymentChain: "ethereum", invoiceNumber: `${invoiceNumber}-BLOCK`, sourceDocument: { ...body.sourceDocument, content: JSON.stringify({ invoiceNumber: `${invoiceNumber}-BLOCK` }) } } });
    const blockedInvoiceId = response.json().data.id;
    createdInvoiceIds.push(blockedInvoiceId);
    await app.inject({ method: "POST", url: `/api/invoices/${blockedInvoiceId}/analyze`, headers: { "x-demo-user-email": "submitter@covendro.local" } });
    const submit = await app.inject({ method: "POST", url: `/api/invoices/${blockedInvoiceId}/submit`, headers: { "x-demo-user-email": "submitter@covendro.local" } });
    const detail = await app.inject({ method: "GET", url: `/api/invoices/${blockedInvoiceId}`, headers: { "x-demo-user-email": "reviewer@covendro.local" } });

    expect(submit.statusCode).toBe(409);
    expect(submit.json().error.code).toBe("PAYMENT_BLOCKED");
    expect(detail.json().data.status).toBe("BLOCKED");
    expect(detail.json().data.policyDecision).toBe("BLOCK");
  });
});
