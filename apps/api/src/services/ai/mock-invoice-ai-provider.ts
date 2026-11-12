import type {
  AnomalyResult,
  InvoiceAIInput,
  InvoiceAIProvider,
  InvoiceExtractionResult,
} from "@covendro/shared";

function formatMinorUnits(value: number) {
  return (value / 100).toFixed(2);
}

export class MockInvoiceAIProvider implements InvoiceAIProvider {
  readonly name = "MockInvoiceAIProvider";
  readonly model = "covendro-mock-v1";

  async extractInvoice(input: InvoiceAIInput): Promise<InvoiceExtractionResult> {
    return {
      fields: {
        vendorName: input.vendorName,
        vendorAddress: input.vendorAddress,
        invoiceNumber: input.invoiceNumber,
        invoiceDate: input.invoiceDate,
        dueDate: input.dueDate ?? undefined,
        currency: input.currency,
        amount: formatMinorUnits(input.amountMinor),
        paymentDestination: input.paymentDestination,
        paymentChain: input.paymentChain ?? undefined,
        memo: input.memo ?? undefined,
        lineItems: input.lineItems.map((item) => ({
          description: item.description,
          quantity: String(item.quantity),
          unitAmount: formatMinorUnits(item.unitAmountMinor),
        })),
      },
      provider: this.name,
      model: this.model,
      confidence: 0.98,
      verificationState: "MOCKED",
      verificationExplanation: "Deterministic local analysis. No external model or attestation was used.",
      requestId: `mock-${input.invoiceId}`,
    };
  }

  async detectAnomalies(input: InvoiceAIInput): Promise<AnomalyResult> {
    const anomalies: AnomalyResult["anomalies"] = [];
    const context = input.context;

    if (!input.vendorName || !input.vendorAddress || !input.invoiceNumber || !input.paymentDestination) {
      anomalies.push({ code: "MISSING_INFORMATION", severity: "BLOCKING", message: "Required vendor, invoice, or payment information is missing." });
    }
    if (context?.duplicateInvoiceNumber) {
      anomalies.push({ code: "DUPLICATE_INVOICE", severity: "BLOCKING", message: "The vendor already has an invoice with this invoice number." });
    }
    if (context?.duplicateFileHash) {
      anomalies.push({ code: "DUPLICATE_DOCUMENT", severity: "BLOCKING", message: "The uploaded document matches a previously processed document." });
    }
    if (context?.vendorAllowlisted === false) {
      anomalies.push({ code: "UNKNOWN_RECIPIENT", severity: "WARNING", message: "The payment recipient is not on the treasury allowlist." });
    }
    if (context?.previousPaymentCount === 0) {
      anomalies.push({ code: "NEW_VENDOR", severity: "INFO", message: "No previous payment history was found for this recipient." });
    }
    if (context?.maxPaymentPerTransactionMinor !== undefined && input.amountMinor > context.maxPaymentPerTransactionMinor) {
      anomalies.push({ code: "UNUSUAL_AMOUNT", severity: "WARNING", message: "The invoice exceeds the current per-transaction policy limit." });
    } else if (input.amountMinor >= 500_000) {
      anomalies.push({ code: "UNUSUAL_AMOUNT", severity: "WARNING", message: "The invoice amount is unusually high for this demo workspace." });
    }

    return {
      anomalies,
      provider: this.name,
      model: this.model,
      requestId: `mock-anomalies-${input.invoiceId}`,
    };
  }
}
