import type { AnomalyResult, InvoiceAIInput, InvoiceExtractionResult } from "@covendro/shared";
import { prisma } from "../../db/prisma.js";
import { ApiError } from "../../errors.js";
import { getInvoiceAIProvider } from "./provider-factory.js";
import { assessInvoiceControls, persistInvoiceControls } from "../risk-assessment-service.js";

function dateOnly(date: Date | null) {
  return date ? date.toISOString().slice(0, 10) : null;
}

function buildInput(invoice: {
  id: string;
  vendor: { name: string; accountAddress: string; accountChain: string | null; allowlisted: boolean };
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date | null;
  currency: string;
  amountMinor: number;
  paymentDestination: string;
  paymentChain: string | null;
  memo: string | null;
  fileHash: string | null;
  lineItems: Array<{ description: string; quantity: number; unitAmountMinor: number; totalAmountMinor: number }>;
  organizationId: string;
}, context: InvoiceAIInput["context"]): InvoiceAIInput {
  return {
    invoiceId: invoice.id,
    vendorName: invoice.vendor.name,
    vendorAddress: invoice.vendor.accountAddress,
    vendorChain: invoice.vendor.accountChain,
    invoiceNumber: invoice.invoiceNumber,
    invoiceDate: dateOnly(invoice.invoiceDate) ?? "",
    dueDate: dateOnly(invoice.dueDate),
    currency: invoice.currency,
    amountMinor: invoice.amountMinor,
    paymentDestination: invoice.paymentDestination,
    paymentChain: invoice.paymentChain,
    memo: invoice.memo,
    lineItems: invoice.lineItems,
    context,
  };
}

export async function analyzeInvoice(invoiceId: string, organizationId: string, requestId: string) {
  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId },
    include: { vendor: true, lineItems: true },
  });
  if (!invoice) throw new ApiError(404, "INVOICE_NOT_FOUND", "Invoice was not found");

  const [duplicateInvoice, duplicateFile, previousPaymentCount, activePolicy] = await Promise.all([
    prisma.invoice.findFirst({ where: { organizationId, vendorId: invoice.vendorId, invoiceNumber: invoice.invoiceNumber, id: { not: invoice.id } }, select: { id: true } }),
    invoice.fileHash ? prisma.invoice.findFirst({ where: { organizationId, fileHash: invoice.fileHash, id: { not: invoice.id } }, select: { id: true } }) : null,
    prisma.invoice.count({ where: { organizationId, vendorId: invoice.vendorId, payment: { isNot: null } } }),
    prisma.treasuryPolicy.findFirst({ where: { organizationId, active: true }, orderBy: { version: "desc" } }),
  ]);
  const input = buildInput(invoice, {
    duplicateInvoiceNumber: Boolean(duplicateInvoice),
    duplicateFileHash: Boolean(duplicateFile),
    vendorAllowlisted: invoice.vendor.allowlisted,
    previousPaymentCount,
    maxPaymentPerTransactionMinor: activePolicy?.maxPaymentPerTransactionMinor,
  });
  const provider = getInvoiceAIProvider();
  let extraction: InvoiceExtractionResult;
  let anomalies: AnomalyResult;
  try {
    [extraction, anomalies] = await Promise.all([provider.extractInvoice(input), provider.detectAnomalies(input)]);
  } catch (error) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { verificationState: "VERIFICATION_FAILED", verificationExplanation: "AI analysis failed before a usable result was produced." } });
    throw new ApiError(502, "AI_ANALYSIS_FAILED", error instanceof Error ? error.message : "AI analysis failed");
  }

  const completedAt = new Date();
  const anomalyResult = { ...anomalies, anomalies: anomalies.anomalies };
  await prisma.invoice.update({
    where: { id: invoice.id },
    data: {
      status: invoice.status === "DRAFT" ? "EXTRACTED" : invoice.status,
      extractedAt: completedAt,
      analysisCompletedAt: completedAt,
      extractionProvider: extraction.provider,
      extractionModel: extraction.model,
      extractionConfidence: extraction.confidence,
      extractionRequestId: extraction.requestId,
      verificationState: extraction.verificationState,
      verificationExplanation: extraction.verificationExplanation,
      anomalyResultJson: JSON.stringify(anomalyResult),
      auditEvents: {
        create: {
          organizationId,
          actorId: invoice.createdById,
          eventType: "AI_ANALYSIS_COMPLETED",
          description: `Invoice analysis completed using ${extraction.provider}`,
          metadataJson: JSON.stringify({ provider: extraction.provider, model: extraction.model, confidence: extraction.confidence, verificationState: extraction.verificationState, anomalyCount: anomalies.anomalies.length }),
          requestId,
        },
      },
    },
    include: { vendor: true, lineItems: true, auditEvents: { orderBy: { createdAt: "desc" } } },
  });

  const controls = await assessInvoiceControls(invoice.id, organizationId);
  const controlledInvoice = await persistInvoiceControls(invoice.id, organizationId, invoice.createdById, requestId, controls);

  return { invoice: controlledInvoice, extraction, anomalies: anomalyResult, controls };
}
