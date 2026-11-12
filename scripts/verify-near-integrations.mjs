import "dotenv/config";
import { NearAICloudProvider } from "../apps/api/src/services/ai/near-ai-cloud-provider.ts";
import { NearIntentsPaymentRail } from "../apps/api/src/services/payments/near-intents-payment-rail.ts";

const missing = [];
if (!process.env.NEAR_AI_CLOUD_API_KEY) missing.push("NEAR_AI_CLOUD_API_KEY");
if (!process.env.NEAR_INTENTS_JWT) missing.push("NEAR_INTENTS_JWT");
if (!process.env.NEAR_INTENTS_ORIGIN_ASSET_ID) missing.push("NEAR_INTENTS_ORIGIN_ASSET_ID");
if (!process.env.NEAR_INTENTS_DESTINATION_ASSET_ID) missing.push("NEAR_INTENTS_DESTINATION_ASSET_ID");
if (!process.env.NEAR_INTENTS_TEST_RECIPIENT) missing.push("NEAR_INTENTS_TEST_RECIPIENT");

if (missing.length > 0) {
  console.error(`Missing local NEAR verification variables: ${missing.join(", ")}`);
  console.error("Set them in an uncommitted .env file. Never paste API keys or JWTs into chat or source files.");
  process.exit(2);
}

const invoiceInput = {
  invoiceId: "near-verification-fictional-invoice",
  vendorName: "Northstar Design Co.",
  vendorAddress: "northstar.near",
  vendorChain: "near",
  invoiceNumber: "NS-2026-001",
  invoiceDate: "2026-11-01",
  dueDate: "2026-11-15",
  currency: "USDC",
  amountMinor: 125000,
  paymentDestination: "northstar.near",
  paymentChain: "near",
  memo: "Fictional integration verification invoice",
  lineItems: [{ description: "Treasury dashboard design", quantity: 1, unitAmountMinor: 90000, totalAmountMinor: 90000 }],
  context: {
    duplicateInvoiceNumber: false,
    duplicateFileHash: false,
    vendorAllowlisted: true,
    previousPaymentCount: 1,
    maxPaymentPerTransactionMinor: 500000,
  },
};

const ai = new NearAICloudProvider();
const extraction = await ai.extractInvoice(invoiceInput);
const anomalies = await ai.detectAnomalies(invoiceInput);
console.log(JSON.stringify({
  nearAiCloud: {
    provider: extraction.provider,
    model: extraction.model,
    verificationState: extraction.verificationState,
    confidence: extraction.confidence,
    extractionRequestIdPresent: Boolean(extraction.requestId),
    anomalyRequestIdPresent: Boolean(anomalies.requestId),
    anomalyCount: anomalies.anomalies.length,
  },
}, null, 2));

const rail = new NearIntentsPaymentRail({
  jwt: process.env.NEAR_INTENTS_JWT,
  originAssetId: process.env.NEAR_INTENTS_ORIGIN_ASSET_ID,
  destinationAssetId: process.env.NEAR_INTENTS_DESTINATION_ASSET_ID,
  originDecimals: Number(process.env.NEAR_INTENTS_ORIGIN_ASSET_DECIMALS ?? 6),
  destinationDecimals: Number(process.env.NEAR_INTENTS_DESTINATION_ASSET_DECIMALS ?? 6),
  dry: true,
});
const supportedAssets = await rail.getSupportedAssets();
const configuredAssets = new Set(supportedAssets.map((asset) => asset.assetId));
if (!configuredAssets.has(process.env.NEAR_INTENTS_ORIGIN_ASSET_ID) || !configuredAssets.has(process.env.NEAR_INTENTS_DESTINATION_ASSET_ID)) {
  throw new Error("Configured NEAR Intents asset IDs were not found in the live token catalog");
}

const quote = await rail.createQuote({
  paymentId: "near-verification-dry-quote",
  amountMinor: 100,
  currency: "USDC",
  sourceChain: process.env.NEAR_INTENTS_ORIGIN_CHAIN ?? "near",
  destinationChain: process.env.NEAR_INTENTS_DESTINATION_CHAIN ?? "base",
  destination: process.env.NEAR_INTENTS_TEST_RECIPIENT,
  refundDestination: process.env.NEAR_INTENTS_REFUND_TO ?? "treasury.covendro.testnet",
  slippageBps: 100,
  deadline: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
});
console.log(JSON.stringify({
  nearIntents: {
    provider: quote.provider,
    mode: quote.mode,
    quoteIdPresent: Boolean(quote.quoteId),
    providerStatus: quote.providerStatus,
    sourceAsset: quote.sourceAsset,
    destinationAsset: quote.destinationAsset,
    depositAddressPresent: Boolean(quote.depositAddress),
    quoteExpiresAt: quote.quoteExpiresAt,
  },
}, null, 2));
