export const paymentQuoteModes = ["MOCK", "REAL_DRY", "REAL_EXECUTED"] as const;
export type PaymentQuoteMode = (typeof paymentQuoteModes)[number];

export const paymentStatuses = ["QUOTE_REQUESTED", "QUOTE_READY", "PAYMENT_PENDING", "PAID", "REFUNDED", "FAILED", "EXPIRED"] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];

export const paymentOutcomes = ["SUCCESS", "REFUNDED", "FAILED", "EXPIRED"] as const;
export type PaymentOutcome = (typeof paymentOutcomes)[number];

export type SupportedAsset = {
  assetId: string;
  symbol: string;
  chain: string;
  decimals: number;
};

export type PaymentQuoteInput = {
  paymentId: string;
  amountMinor: number;
  currency: string;
  sourceChain: string;
  destinationChain: string;
  destination: string;
  refundDestination: string;
  slippageBps: number;
  deadline: string;
};

export type PaymentQuote = {
  quoteId: string;
  mode: PaymentQuoteMode;
  provider: string;
  sourceAsset: string;
  destinationAsset: string;
  sourceChain: string;
  destinationChain: string;
  amountMinor: number;
  estimatedReceivedMinor: number;
  slippageBps: number;
  quoteExpiresAt: string;
  refundDestination: string;
  depositAddress?: string;
  depositMemo?: string;
  depositRequirements?: Record<string, unknown>;
  providerStatus: string;
  requestId?: string;
};

export type PaymentStatusResult = {
  status: PaymentStatus;
  providerStatus: string;
  transactionHash?: string;
  refundStatus?: string;
};

export interface PaymentRail {
  readonly name: string;
  readonly mode: PaymentQuoteMode;
  getSupportedAssets(): Promise<SupportedAsset[]>;
  createQuote(input: PaymentQuoteInput): Promise<PaymentQuote>;
  getStatus(paymentId: string, context?: { depositAddress?: string }): Promise<PaymentStatusResult>;
  simulate?(paymentId: string, outcome: PaymentOutcome): Promise<PaymentStatusResult>;
}
