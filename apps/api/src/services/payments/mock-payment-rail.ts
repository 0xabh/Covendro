import type { PaymentOutcome, PaymentQuote, PaymentQuoteInput, PaymentRail, PaymentStatusResult, SupportedAsset } from "@covendro/shared";

export class MockPaymentRail implements PaymentRail {
  readonly name = "MockPaymentRail";
  readonly mode = "MOCK" as const;

  async getSupportedAssets(): Promise<SupportedAsset[]> {
    return [
      { assetId: "mock:USDC", symbol: "USDC", chain: "near", decimals: 6 },
      { assetId: "mock:USDT", symbol: "USDT", chain: "near", decimals: 6 },
      { assetId: "mock:USDC:ethereum", symbol: "USDC", chain: "ethereum", decimals: 6 },
      { assetId: "mock:USDC:base", symbol: "USDC", chain: "base", decimals: 6 },
    ];
  }

  async createQuote(input: PaymentQuoteInput): Promise<PaymentQuote> {
    return {
      quoteId: `mock-quote-${input.paymentId}`,
      mode: this.mode,
      provider: this.name,
      sourceAsset: `mock:${input.currency}`,
      destinationAsset: `mock:${input.currency}:${input.destinationChain}`,
      sourceChain: input.sourceChain,
      destinationChain: input.destinationChain,
      amountMinor: input.amountMinor,
      estimatedReceivedMinor: Math.floor(input.amountMinor * 0.995),
      slippageBps: input.slippageBps,
      quoteExpiresAt: input.deadline,
      refundDestination: input.refundDestination,
      depositAddress: `mock-deposit-${input.paymentId}`,
      depositMemo: `covendro-${input.paymentId.slice(-8)}`,
      depositRequirements: { depositType: "MOCK", requiredAmountMinor: input.amountMinor, currency: input.currency },
      providerStatus: "PENDING_DEPOSIT",
      requestId: `mock-request-${input.paymentId}`,
    };
  }

  async getStatus(): Promise<PaymentStatusResult> {
    return { status: "QUOTE_READY", providerStatus: "PENDING_DEPOSIT" };
  }

  async simulate(paymentId: string, outcome: PaymentOutcome): Promise<PaymentStatusResult> {
    if (outcome === "SUCCESS") return { status: "PAID", providerStatus: "SUCCESS", transactionHash: `mock-tx-${paymentId}` };
    if (outcome === "REFUNDED") return { status: "REFUNDED", providerStatus: "REFUNDED", refundStatus: "REFUNDED" };
    if (outcome === "FAILED") return { status: "FAILED", providerStatus: "FAILED" };
    return { status: "EXPIRED", providerStatus: "EXPIRED" };
  }
}
