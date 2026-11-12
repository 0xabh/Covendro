import type { PaymentQuote, PaymentQuoteInput, PaymentRail, PaymentStatusResult, SupportedAsset } from "@covendro/shared";

type FetchLike = typeof fetch;

type NearQuoteResponse = Record<string, unknown> & {
  quote?: Record<string, unknown>;
};

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusFromProvider(value: unknown): PaymentStatusResult["status"] {
  switch (value) {
    case "SUCCESS": return "PAID";
    case "REFUNDED": return "REFUNDED";
    case "FAILED": return "FAILED";
    case "PENDING_DEPOSIT":
    case "KNOWN_DEPOSIT_TX":
    case "PROCESSING": return "PAYMENT_PENDING";
    default: return "QUOTE_READY";
  }
}

export class NearIntentsPaymentRail implements PaymentRail {
  readonly name = "NearIntentsPaymentRail";
  readonly mode: "REAL_DRY" | "REAL_EXECUTED";
  private readonly apiUrl: string;
  private readonly jwt: string;
  private readonly originAssetId: string;
  private readonly destinationAssetId: string;
  private readonly originDecimals: number;
  private readonly destinationDecimals: number;
  private readonly dry: boolean;
  private readonly fetchImpl: FetchLike;

  constructor(options: { apiUrl?: string; jwt: string; originAssetId: string; destinationAssetId: string; originDecimals?: number; destinationDecimals?: number; dry?: boolean; fetchImpl?: FetchLike }) {
    this.apiUrl = (options.apiUrl ?? process.env.NEAR_INTENTS_API_URL ?? "https://1click.chaindefuser.com/v0").replace(/\/$/, "");
    this.jwt = options.jwt;
    this.originAssetId = options.originAssetId;
    this.destinationAssetId = options.destinationAssetId;
    this.originDecimals = options.originDecimals ?? Number(process.env.NEAR_INTENTS_ORIGIN_ASSET_DECIMALS ?? 6);
    this.destinationDecimals = options.destinationDecimals ?? Number(process.env.NEAR_INTENTS_DESTINATION_ASSET_DECIMALS ?? this.originDecimals);
    this.dry = options.dry ?? (process.env.REAL_PAYMENTS_ENABLED !== "true" || process.env.NEAR_INTENTS_DRY_RUN !== "false");
    this.mode = this.dry ? "REAL_DRY" : "REAL_EXECUTED";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getSupportedAssets(): Promise<SupportedAsset[]> {
    const response = await this.fetchImpl(`${this.apiUrl}/tokens`, { headers: { authorization: `Bearer ${this.jwt}` } });
    if (!response.ok) throw new Error(`NEAR Intents token request failed with status ${response.status}`);
    return await response.json() as SupportedAsset[];
  }

  async createQuote(input: PaymentQuoteInput): Promise<PaymentQuote> {
    const atomicAmount = String(input.amountMinor * 10 ** Math.max(this.originDecimals - 2, 0));
    const response = await this.fetchImpl(`${this.apiUrl}/quote`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        dry: this.dry,
        swapType: "EXACT_INPUT",
        slippageTolerance: input.slippageBps,
        originAsset: this.originAssetId,
        depositType: "ORIGIN_CHAIN",
        destinationAsset: this.destinationAssetId,
        amount: atomicAmount,
        recipient: input.destination,
        recipientType: "DESTINATION_CHAIN",
        refundTo: input.refundDestination,
        refundType: "ORIGIN_CHAIN",
        deadline: input.deadline,
      }),
    });
    if (!response.ok) throw new Error(`NEAR Intents quote request failed with status ${response.status}`);
    const responseBody = await response.json() as NearQuoteResponse;
    const quote = responseBody.quote ?? responseBody;
    const amountOutAtomic = numberValue(quote.amountOut ?? quote.destinationAmount ?? quote.amount_out, input.amountMinor * 10 ** Math.max(this.destinationDecimals - 2, 0));
    return {
      quoteId: stringValue(quote.quoteId ?? quote.id, `near-intents-${input.paymentId}`),
      mode: this.mode,
      provider: this.name,
      sourceAsset: this.originAssetId,
      destinationAsset: this.destinationAssetId,
      sourceChain: input.sourceChain,
      destinationChain: input.destinationChain,
      amountMinor: input.amountMinor,
      estimatedReceivedMinor: Math.floor(amountOutAtomic / 10 ** Math.max(this.destinationDecimals - 2, 0)),
      slippageBps: input.slippageBps,
      quoteExpiresAt: stringValue(quote.deadline ?? quote.expirationTime, input.deadline),
      refundDestination: input.refundDestination,
      depositAddress: typeof quote.depositAddress === "string" ? quote.depositAddress : undefined,
      depositMemo: typeof quote.depositMemo === "string" ? quote.depositMemo : undefined,
      depositRequirements: { depositType: "ORIGIN_CHAIN", depositAddress: quote.depositAddress, depositMemo: quote.depositMemo },
      providerStatus: stringValue(quote.status, "PENDING_DEPOSIT"),
      requestId: response.headers.get("x-request-id") ?? undefined,
    };
  }

  async getStatus(_paymentId: string, context?: { depositAddress?: string }): Promise<PaymentStatusResult> {
    if (!context?.depositAddress) return { status: "QUOTE_READY", providerStatus: "PENDING_DEPOSIT" };
    const response = await this.fetchImpl(`${this.apiUrl}/status?depositAddress=${encodeURIComponent(context.depositAddress)}`, { headers: { authorization: `Bearer ${this.jwt}` } });
    if (!response.ok) throw new Error(`NEAR Intents status request failed with status ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    const providerStatus = stringValue(body.status, "PENDING_DEPOSIT");
    return {
      status: statusFromProvider(providerStatus),
      providerStatus,
      transactionHash: typeof body.swapTransaction === "string" ? body.swapTransaction : typeof body.txHash === "string" ? body.txHash : undefined,
      refundStatus: providerStatus === "REFUNDED" ? "REFUNDED" : undefined,
    };
  }
}
