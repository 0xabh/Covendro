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

  beforeAll(async () => {
    await app.ready();
  });

  afterAll(async () => {
    if (invoiceId) await prisma.invoice.delete({ where: { id: invoiceId } });
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
});
