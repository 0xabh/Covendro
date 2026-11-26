import { quoteHash, verifyQuoteSignature, type QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import { z } from "zod";
import { ApiError } from "../../errors.js";

const endpoint = "https://1click.chaindefuser.com/v0";
export const nearMainnetAccount = /^(?!.*\.testnet$)(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/;
const evmContract = /^0x[a-fA-F0-9]{40}$/;
const atomicAmount = z.string().regex(/^(?:0|[1-9][0-9]{0,38})$/);
const providerTimestamp = z.iso.datetime({ offset: true });
export const usdcAtomicPerCent = 10_000n;

export function pilotMaxDebitMinor() {
  const value = process.env.PILOT_MAX_DEBIT_MINOR;
  return value && /^[1-9][0-9]{0,8}$/.test(value) ? Number(value) : null;
}

export function pilotRoute() {
  const apiKey = process.env.NEAR_INTENTS_API_KEY;
  const sourceAsset = process.env.NEAR_INTENTS_ORIGIN_ASSET_ID;
  const destinationAsset = process.env.NEAR_INTENTS_DESTINATION_ASSET_ID;
  const sourceContract = process.env.PILOT_NEAR_USDC_CONTRACT;
  const destinationContract = process.env.PILOT_BASE_USDC_CONTRACT;
  if (!apiKey || !sourceAsset || !destinationAsset || !sourceContract || !destinationContract ||
      sourceAsset === destinationAsset || !nearMainnetAccount.test(sourceContract) || !evmContract.test(destinationContract)) {
    throw new ApiError(503, "LIVE_ROUTE_UNCONFIGURED", "Configure the approved NEAR and Base USDC assets and provider credentials");
  }
  return { apiKey, sourceAsset, destinationAsset, sourceContract, destinationContract: destinationContract.toLowerCase() };
}

type PilotRoute = ReturnType<typeof pilotRoute>;

const catalog = z.array(z.object({
  assetId: z.string(), blockchain: z.string(), symbol: z.string(),
  decimals: z.number().int(), contractAddress: z.string().optional().nullable(),
}));
const quoteFields = z.object({
  amountIn: atomicAmount, minAmountIn: atomicAmount, amountOut: atomicAmount, minAmountOut: atomicAmount,
  depositAddress: z.string().regex(nearMainnetAccount), depositMemo: z.string().min(1).max(256).optional().nullable(),
  deadline: providerTimestamp, timeWhenInactive: providerTimestamp.optional().nullable(),
  refundFee: atomicAmount.optional().nullable(), withdrawFee: atomicAmount.optional().nullable(),
});
const quoteEnvelope = z.object({
  correlationId: z.string().max(256).optional(),
  signature: z.string().min(1).max(128), timestamp: providerTimestamp,
  quoteRequest: z.record(z.string(), z.unknown()), quote: quoteFields,
});

async function providerRequest(path: string, apiKey: string, body?: object): Promise<unknown> {
  try {
    const response = await fetch(endpoint + path, {
      method: body ? "POST" : "GET",
      headers: { "X-API-Key": apiKey, ...(body ? { "content-type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(8_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Request rejected");
    return await response.json();
  } catch {
    throw new ApiError(502, "LIVE_QUOTE_PROVIDER_UNAVAILABLE", "1Click could not provide a firm quote");
  }
}

export async function requestLiveQuote(route: PilotRoute, terms: {
  payableAmountMinor: number; destinationAddress: string; sourceAccountId: string; refundAccountId: string;
}) {
  const tokens = catalog.safeParse(await providerRequest("/tokens", route.apiKey));
  if (!tokens.success || !tokens.data.some((asset) => asset.assetId === route.sourceAsset &&
      asset.blockchain === "near" && asset.symbol === "USDC" && asset.decimals === 6 && asset.contractAddress === route.sourceContract) ||
      !tokens.data.some((asset) => asset.assetId === route.destinationAsset &&
      asset.blockchain === "base" && asset.symbol === "USDC" && asset.decimals === 6 && asset.contractAddress?.toLowerCase() === route.destinationContract)) {
    throw new ApiError(409, "LIVE_ASSET_MISMATCH", "The approved contracts do not match the 1Click token catalog");
  }
  const request = {
    dry: false, swapType: "EXACT_OUTPUT", slippageTolerance: 100,
    originAsset: route.sourceAsset, destinationAsset: route.destinationAsset,
    amount: (BigInt(terms.payableAmountMinor) * usdcAtomicPerCent).toString(),
    depositType: "ORIGIN_CHAIN", refundType: "ORIGIN_CHAIN", recipientType: "DESTINATION_CHAIN",
    recipient: terms.destinationAddress, refundTo: terms.refundAccountId,
    deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  const raw = await providerRequest("/quote", route.apiKey, request);
  const parsed = quoteEnvelope.safeParse(raw);
  if (!parsed.success || !verifyQuoteSignature(raw as QuoteResponse)) {
    throw new ApiError(502, "LIVE_QUOTE_SIGNATURE_INVALID", "1Click did not return a verifiable quote");
  }
  const { quote, quoteRequest, correlationId } = parsed.data;
  const timestamp = Date.parse(parsed.data.timestamp);
  const expiresAt = new Date(Math.min(Date.parse(quote.deadline), Date.parse(quote.timeWhenInactive ?? quote.deadline)));
  if (Object.entries(request).some(([key, value]) => quoteRequest[key] !== value) ||
      timestamp < Date.now() - 60_000 || timestamp > Date.now() + 15_000 ||
      expiresAt.getTime() <= Date.now() + 30_000 || expiresAt.getTime() > Date.parse(request.deadline) ||
      quote.amountOut !== request.amount || quote.minAmountOut !== request.amount ||
      BigInt(quote.minAmountIn) <= 0n || BigInt(quote.minAmountIn) > BigInt(quote.amountIn) ||
      quote.depositAddress === terms.sourceAccountId || quote.depositAddress === route.sourceContract) {
    throw new ApiError(502, "LIVE_QUOTE_TERMS_INVALID", "1Click quote terms differ from the authorized payable");
  }
  return {
    originDebitAtomic: quote.amountIn, destinationAmountAtomic: quote.amountOut,
    depositAccountId: quote.depositAddress, depositMemo: quote.depositMemo ?? null,
    quoteHash: quoteHash(raw as QuoteResponse), providerCorrelationId: correlationId,
    quoteExpiresAt: expiresAt, slippageBps: request.slippageTolerance,
    refundFeeAtomic: quote.refundFee ?? null, withdrawFeeAtomic: quote.withdrawFee ?? null,
  };
}
