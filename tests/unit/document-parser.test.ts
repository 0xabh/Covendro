import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { parseInvoiceText, parseSourceDocument } from "../../apps/api/src/services/document-parser.js";

const textInvoice = `Vendor Name: Northstar Design Co.
Vendor Address: northstar.near
Vendor Chain: near
Invoice Number: NS-TEXT-003
Invoice Date: 2026-11-05
Due Date: 2026-11-19
Currency: USDC
Amount: 640.00
Item: Treasury policy review | quantity=1 | unitAmount=640.00
Payment Destination: northstar.near
Payment Chain: near`;

describe("document parser", () => {
  it("extracts candidate invoice fields from plain text", () => {
    const fields = parseInvoiceText(textInvoice);

    expect(fields).toMatchObject({
      vendorName: "Northstar Design Co.",
      invoiceNumber: "NS-TEXT-003",
      amount: "640.00",
      paymentDestination: "northstar.near",
    });
    expect(fields.lineItems).toEqual([{ description: "Treasury policy review", quantity: "1", unitAmount: "640.00" }]);
  });

  it("parses JSON documents without storing the original content", async () => {
    const parsed = await parseSourceDocument({
      fileName: "invoice.json",
      fileType: "application/json",
      content: JSON.stringify({ invoiceNumber: "JSON-001", amount: "10.00" }),
    });

    expect(parsed.parser).toBe("JSON");
    expect(parsed.fields).toMatchObject({ invoiceNumber: "JSON-001", amount: "10.00" });
  });

  it("extracts candidate fields from a real PDF buffer", async () => {
    const document = new PDFDocument();
    const chunks: Buffer[] = [];
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    const pdf = new Promise<Buffer>((resolve) => document.on("end", () => resolve(Buffer.concat(chunks))));
    document.fontSize(12).text("Vendor Name: Northstar Design Co.");
    document.text("Invoice Number: PDF-001");
    document.text("Amount: 640.00");
    document.text("Payment Destination: northstar.near");
    document.end();

    const parsed = await parseSourceDocument({
      fileName: "invoice.pdf",
      fileType: "application/pdf",
      content: (await pdf).toString("base64"),
      encoding: "base64",
    });

    expect(parsed.parser).toBe("PDF_TEXT");
    expect(parsed.pageCount).toBe(1);
    expect(parsed.fields).toMatchObject({ invoiceNumber: "PDF-001", amount: "640.00", paymentDestination: "northstar.near" });
  });
});
