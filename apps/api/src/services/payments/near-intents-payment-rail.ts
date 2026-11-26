import type { PaymentQuote, PaymentQuoteInput, PaymentRail, PaymentStatusResult, SupportedAsset } from "@covendro/shared";

type FetchLike = typeof fetch;

type NearQuoteResponse = Record<string, unknown> & {
  quote?: Record<string, unknown>;
};

function stringValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function atomicUnitsPerCent(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 255) {
    throw new Error("Unsupported 1Click asset precision");
  }
  return 10n ** BigInt(decimals - 2);
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

async function providerError(response: Response) {
  const raw = await response.text();
  if (!raw) return `status ${response.status}`;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const detail = parsed.message ?? parsed.error ?? parsed.detail;
    if (typeof detail === "string" && detail.length > 0) return `status ${response.status}: ${detail.slice(0, 500)}`;
  } catch {
    // Fall back to a bounded plain-text response below.
  }
  return `status ${response.status}: ${raw.replace(/\s+/g, " ").slice(0, 500)}`;
}

export class NearIntentsPaymentRail implements PaymentRail {
  readonly name = "NearIntentsPaymentRail";
  readonly mode = "REAL_DRY" as const;
  private readonly apiUrl: string;
  private readonly jwt: string;
  private readonly originAssetId: string;
  private readonly destinationAssetId: string;
  private readonly originDecimals: number;
  private readonly destinationDecimals: number;
  private readonly fetchImpl: FetchLike;
  private readonly pilotPreview: boolean;

  constructor(options: { apiUrl?: string; jwt: string; originAssetId: string; destinationAssetId: string; originDecimals?: number; destinationDecimals?: number; fetchImpl?: FetchLike; pilotPreview?: boolean }) {
    this.apiUrl = (options.apiUrl ?? process.env.NEAR_INTENTS_API_URL ?? "https://1click.chaindefuser.com/v0").replace(/\/$/, "");
    this.jwt = options.jwt;
    this.originAssetId = options.originAssetId;
    this.destinationAssetId = options.destinationAssetId;
    this.originDecimals = options.originDecimals ?? Number(process.env.NEAR_INTENTS_ORIGIN_ASSET_DECIMALS ?? 6);
    this.destinationDecimals = options.destinationDecimals ?? Number(process.env.NEAR_INTENTS_DESTINATION_ASSET_DECIMALS ?? this.originDecimals);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pilotPreview = options.pilotPreview ?? false;
  }

  async getSupportedAssets(): Promise<SupportedAsset[]> {
    const response = await this.fetchImpl(`${this.apiUrl}/tokens`, { headers: { authorization: `Bearer ${this.jwt}` } });
    if (!response.ok) throw new Error(`NEAR Intents token request failed with status ${response.status}`);
    const assets: unknown = await response.json();
    if (!Array.isArray(assets)) throw new Error("Invalid 1Click token catalog");
    return assets.flatMap((asset) => {
      if (!asset || typeof asset.assetId !== "string" || typeof asset.symbol !== "string" ||
          typeof asset.blockchain !== "string" || !Number.isInteger(asset.decimals)) return [];
      return [{ assetId: asset.assetId, symbol: asset.symbol, chain: asset.blockchain, decimals: asset.decimals }];
    });
  }

  async createQuote(input: PaymentQuoteInput): Promise<PaymentQuote> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
      throw new Error("Invalid 1Click quote amount");
    }
    const destinationUnitsPerCent = atomicUnitsPerCent(this.destinationDecimals);
    const originUnitsPerCent = atomicUnitsPerCent(this.originDecimals);
    const swapType = this.pilotPreview ? "EXACT_OUTPUT" : "EXACT_INPUT";
    const atomicAmount = (BigInt(input.amountMinor) * (this.pilotPreview ? destinationUnitsPerCent : originUnitsPerCent)).toString();
    if (this.pilotPreview) {
      if (input.sourceChain !== "near" || input.destinationChain !== "base" || input.currency !== "USDC") {
        throw new Error("Pilot previews support NEAR to Base USDC only");
      }
      const tokens = await this.getSupportedAssets();
      const origin = tokens.find((asset) => asset.assetId === this.originAssetId);
      const destination = tokens.find((asset) => asset.assetId === this.destinationAssetId);
      if (origin?.chain !== "near" || origin.symbol !== "USDC" || origin.decimals !== this.originDecimals ||
          destination?.chain !== "base" || destination.symbol !== "USDC" || destination.decimals !== this.destinationDecimals) {
        throw new Error("The configured pilot assets do not match the 1Click catalog");
      }
    }
    const response = await this.fetchImpl(`${this.apiUrl}/quote`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.jwt}`, "content-type": "application/json" },
      body: JSON.stringify({
        dry: true,
        swapType,
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
    if (!response.ok) throw new Error(`NEAR Intents quote request failed with ${await providerError(response)}`);
    const responseBody = await response.json() as NearQuoteResponse;
    const quote = responseBody.quote ?? responseBody;
    const amountOut = quote.amountOut ?? quote.destinationAmount ?? quote.amount_out;
    if (typeof amountOut !== "string" || !/^\d+$/.test(amountOut)) {
      throw new Error("1Click quote is missing a valid output amount");
    }
    if (this.pilotPreview && BigInt(amountOut) !== BigInt(atomicAmount)) {
      throw new Error("The 1Click quote does not deliver the exact payable amount");
    }
    const estimatedReceivedMinor = Number(BigInt(amountOut) / destinationUnitsPerCent);
    if (!Number.isSafeInteger(estimatedReceivedMinor)) {
      throw new Error("1Click output amount exceeds the supported range");
    }
    return {
      quoteId: stringValue(quote.quoteId ?? quote.id, `near-intents-${input.paymentId}`),
      mode: this.mode,
      provider: this.name,
      sourceAsset: this.originAssetId,
      destinationAsset: this.destinationAssetId,
      sourceChain: input.sourceChain,
      destinationChain: input.destinationChain,
      amountMinor: input.amountMinor,
      estimatedReceivedMinor,
      slippageBps: input.slippageBps,
      quoteExpiresAt: stringValue(quote.deadline ?? quote.expirationTime, input.deadline),
      refundDestination: input.refundDestination,
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
