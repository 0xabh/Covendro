import path from "node:path";
import { PDFParse } from "pdf-parse";
import type { InvoiceInput } from "@covendro/shared";

export type SourceDocument = {
  fileName: string;
  fileType: string;
  content: string;
  encoding?: "utf8" | "base64";
};

export type ParsedDocument = {
  parser: "JSON" | "PLAIN_TEXT" | "PDF_TEXT";
  text: string;
  pageCount?: number;
  fields: Partial<InvoiceInput>;
};

function decodeContent(document: SourceDocument) {
  return document.encoding === "base64"
    ? Buffer.from(document.content, "base64")
    : Buffer.from(document.content, "utf8");
}

function findLabel(text: string, labels: string[]) {
  for (const line of text.split(/\r?\n/)) {
    const normalized = line.trim();
    for (const label of labels) {
      const match = normalized.match(new RegExp(`^${label}\\s*:\\s*(.+)$`, "i"));
      if (match?.[1]) return match[1].trim();
    }
  }
  return undefined;
}

function parseLineItems(text: string) {
  const items = text.split(/\r?\n/).flatMap((line) => {
    const match = line.trim().match(/^Item\s*:\s*(.+?)\s*\|\s*quantity\s*=\s*([\d.]+)\s*\|\s*unitAmount\s*=\s*([\d.]+)$/i);
    return match ? [{ description: match[1], quantity: match[2], unitAmount: match[3] }] : [];
  });
  return items.length ? items : undefined;
}

export function parseInvoiceText(text: string): Partial<InvoiceInput> {
  const lineItems = parseLineItems(text);
  return {
    vendorName: findLabel(text, ["Vendor Name", "Vendor"]),
    vendorAddress: findLabel(text, ["Vendor Address", "Vendor Account"]),
    vendorChain: findLabel(text, ["Vendor Chain"])?.toLowerCase() as InvoiceInput["vendorChain"],
    invoiceNumber: findLabel(text, ["Invoice Number", "Invoice No"]),
    invoiceDate: findLabel(text, ["Invoice Date"]),
    dueDate: findLabel(text, ["Due Date"]),
    currency: findLabel(text, ["Currency"])?.toUpperCase() as InvoiceInput["currency"],
    amount: findLabel(text, ["Amount", "Total"]),
    lineItems,
    paymentDestination: findLabel(text, ["Payment Destination", "Payment Account"]),
    paymentChain: findLabel(text, ["Payment Chain"])?.toLowerCase() as InvoiceInput["paymentChain"],
    memo: findLabel(text, ["Memo"]),
  };
}

export async function parseSourceDocument(document: SourceDocument): Promise<ParsedDocument> {
  const extension = path.extname(document.fileName).toLowerCase();
  const bytes = decodeContent(document);
  const isPdf = document.fileType === "application/pdf" || extension === ".pdf";

  if (isPdf) {
    const parser = new PDFParse({ data: bytes });
    try {
      const parsed = await parser.getText();
      return { parser: "PDF_TEXT", text: parsed.text.trim(), pageCount: parsed.total, fields: parseInvoiceText(parsed.text) };
    } finally {
      await parser.destroy();
    }
  }

  const text = bytes.toString("utf8").trim();
  if (document.fileType === "application/json" || extension === ".json") {
    return { parser: "JSON", text, fields: JSON.parse(text) as Partial<InvoiceInput> };
  }

  return { parser: "PLAIN_TEXT", text, fields: parseInvoiceText(text) };
}
