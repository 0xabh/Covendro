import { describe, expect, it, vi } from "vitest";
import { MockInvoiceAIProvider } from "../../apps/api/src/services/ai/mock-invoice-ai-provider.js";
import { NearAICloudProvider } from "../../apps/api/src/services/ai/near-ai-cloud-provider.js";
import type { InvoiceAIInput } from "@covendro/shared";

const input: InvoiceAIInput = {
  invoiceId: "invoice-1",
  vendorName: "Suspicious Vendor",
  vendorAddress: "vendor.near",
  vendorChain: "near",
  invoiceNumber: "SUSP-001",
  invoiceDate: "2026-11-01",
  dueDate: "2026-11-15",
  currency: "USDC",
  amountMinor: 980000,
  paymentDestination: "vendor.near",
  paymentChain: "near",
  lineItems: [{ description: "Consulting", quantity: 1, unitAmountMinor: 980000, totalAmountMinor: 980000 }],
  context: { vendorAllowlisted: false, previousPaymentCount: 0, maxPaymentPerTransactionMinor: 500000 },
};

describe("invoice AI providers", () => {
  it("returns deterministic mock extraction and anomaly reasons", async () => {
    const provider = new MockInvoiceAIProvider();
    const extraction = await provider.extractInvoice(input);
    const anomalies = await provider.detectAnomalies(input);

    expect(extraction.verificationState).toBe("MOCKED");
    expect(extraction.fields.invoiceNumber).toBe("SUSP-001");
    expect(anomalies.anomalies.map((item) => item.code)).toEqual(["UNKNOWN_RECIPIENT", "NEW_VENDOR", "UNUSUAL_AMOUNT"]);
  });

  it("calls the NEAR AI Cloud OpenAI-compatible endpoint without exposing document content in errors", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: "completion-1",
      choices: [{ message: { content: JSON.stringify({ vendorName: "Suspicious Vendor", invoiceNumber: "SUSP-001", confidence: 0.91, lineItems: [] }) } }],
    }), { status: 200, headers: { "x-request-id": "near-request-1" } }));
    const provider = new NearAICloudProvider({ apiKey: "test-key", baseUrl: "https://example.test/v1", model: "test-model", fetchImpl });
    const result = await provider.extractInvoice(input);
    const request = fetchImpl.mock.calls[0];

    expect(request[0]).toBe("https://example.test/v1/chat/completions");
    expect((request[1]?.headers as Record<string, string>).authorization).toBe("Bearer test-key");
    const requestBody = JSON.parse(String(request[1]?.body)) as Record<string, unknown>;
    expect(requestBody.response_format).toBeUndefined();
    expect(result.requestId).toBe("near-request-1");
    expect(result.verificationState).toBe("UNVERIFIED");
    expect(result.verificationExplanation).toContain("attestation");
  });

  it("surfaces a safe provider error message for rejected requests", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      error: { message: "Unsupported request field: response_format", type: "invalid_request_error" },
    }), { status: 400 }));
    const provider = new NearAICloudProvider({ apiKey: "test-key", fetchImpl });

    await expect(provider.extractInvoice(input)).rejects.toThrow(
      "NEAR AI Cloud request failed with status 400: Unsupported request field: response_format",
    );
  });
});
