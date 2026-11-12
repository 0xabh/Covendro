import type {
  Anomaly,
  AnomalyResult,
  InvoiceAIInput,
  InvoiceAIProvider,
  InvoiceExtractionResult,
} from "@covendro/shared";

type FetchLike = typeof fetch;

type ChatResponse = {
  id?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null };
  }>;
};

type ChatErrorResponse = {
  error?: {
    message?: string;
  };
};

function compactInput(input: InvoiceAIInput) {
  return {
    invoiceId: input.invoiceId,
    vendorName: input.vendorName,
    vendorAddress: input.vendorAddress,
    vendorChain: input.vendorChain,
    invoiceNumber: input.invoiceNumber,
    invoiceDate: input.invoiceDate,
    dueDate: input.dueDate,
    currency: input.currency,
    amountMinor: input.amountMinor,
    paymentDestination: input.paymentDestination,
    paymentChain: input.paymentChain,
    memo: input.memo,
    lineItems: input.lineItems,
  };
}

function parseContent(response: ChatResponse) {
  const choice = response.choices?.[0];
  const content = choice?.message?.content;
  if (!content) {
    const choiceCount = response.choices?.length ?? 0;
    const finishReason = choice?.finish_reason ?? "unknown";
    throw new Error(`NEAR AI Cloud returned no message content (choices=${choiceCount}, finish_reason=${finishReason})`);
  }
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1] ?? content;
  return JSON.parse(fenced) as Record<string, unknown>;
}

export class NearAICloudProvider implements InvoiceAIProvider {
  readonly name = "NearAICloudProvider";
  readonly model: string;
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly fetchImpl: FetchLike;

  constructor(options?: { apiKey?: string; baseUrl?: string; model?: string; fetchImpl?: FetchLike }) {
    this.apiKey = options?.apiKey ?? process.env.NEAR_AI_CLOUD_API_KEY ?? "";
    this.endpoint = `${(options?.baseUrl ?? process.env.NEAR_AI_CLOUD_BASE_URL ?? "https://cloud-api.near.ai/v1").replace(/\/$/, "")}/chat/completions`;
    this.model = options?.model?.trim() || process.env.NEAR_AI_CLOUD_MODEL?.trim() || "google/gemini-2.5-flash-lite";
    this.fetchImpl = options?.fetchImpl ?? fetch;
    if (!this.apiKey) throw new Error("NEAR_AI_CLOUD_API_KEY is required for NearAICloudProvider");
  }

  private async complete(system: string, input: InvoiceAIInput) {
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          messages: [
            { role: "system", content: system },
            { role: "user", content: JSON.stringify(compactInput(input)) },
          ],
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const raw = await response.text();
        let detail = "";
        try {
          const errorBody = JSON.parse(raw) as ChatErrorResponse;
          if (typeof errorBody.error?.message === "string") {
            detail = errorBody.error.message.slice(0, 240);
          }
        } catch {
          // Keep provider response bodies out of logs and user-facing errors.
        }
        throw new Error(`NEAR AI Cloud request failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
      }
      const body = await response.json() as ChatResponse;
      return { body, requestId: response.headers.get("x-request-id") ?? body.id };
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        throw new Error("NEAR AI Cloud request timed out after 120 seconds");
      }
      throw error;
    }
  }

  async extractInvoice(input: InvoiceAIInput): Promise<InvoiceExtractionResult> {
    const { body, requestId } = await this.complete(
      "Extract invoice fields as JSON with vendorName, vendorAddress, invoiceNumber, invoiceDate, dueDate, currency, amount, paymentDestination, paymentChain, memo, lineItems, and confidence. Do not invent missing values.",
      input,
    );
    const parsed = parseContent(body);
    return {
      fields: parsed as unknown as InvoiceExtractionResult["fields"],
      provider: this.name,
      model: this.model,
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0,
      verificationState: "UNVERIFIED",
      verificationExplanation: "NEAR AI Cloud returned structured inference, but this MVP did not complete an attestation or response-signature verification.",
      requestId,
    };
  }

  async detectAnomalies(input: InvoiceAIInput): Promise<AnomalyResult> {
    const { body, requestId } = await this.complete(
      "Detect invoice anomalies as JSON with an anomalies array. Each anomaly must have code, severity (INFO, WARNING, or BLOCKING), and message. Use only the supplied invoice data and context.",
      input,
    );
    const parsed = parseContent(body);
    const anomalies = Array.isArray(parsed.anomalies) ? parsed.anomalies as Anomaly[] : [];
    return { anomalies, provider: this.name, model: this.model, requestId };
  }
}
