import { describe, expect, it, vi } from "vitest";
import type { PaymentQuoteInput } from "@covendro/shared";
import { MockPaymentRail } from "../../apps/api/src/services/payments/mock-payment-rail.js";
import { NearIntentsPaymentRail } from "../../apps/api/src/services/payments/near-intents-payment-rail.js";

const input: PaymentQuoteInput = {
  paymentId: "payment-1",
  amountMinor: 125000,
  currency: "USDC",
  sourceChain: "near",
  destinationChain: "ethereum",
  destination: "0x1111111111111111111111111111111111111111",
  refundDestination: "treasury.covendro.testnet",
  slippageBps: 100,
  deadline: "2026-11-13T00:05:00.000Z",
};

describe("payment rails", () => {
  it("creates a labelled mock quote and deterministic outcomes", async () => {
    const rail = new MockPaymentRail();
    const quote = await rail.createQuote(input);
    expect(quote).toMatchObject({ mode: "MOCK", quoteId: "mock-quote-payment-1", providerStatus: "PENDING_DEPOSIT" });
    expect(quote.estimatedReceivedMinor).toBe(124375);
    expect((await rail.simulate!("payment-1", "SUCCESS")).status).toBe("PAID");
    expect((await rail.simulate!("payment-1", "REFUNDED")).refundStatus).toBe("REFUNDED");
    expect((await rail.simulate!("payment-1", "FAILED")).status).toBe("FAILED");
    expect((await rail.simulate!("payment-1", "EXPIRED")).status).toBe("EXPIRED");
  });

  it("uses the 1Click dry quote contract without making an external call in tests", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ quoteId: "near-quote-1", amountOut: "124000000", depositAddress: "deposit.near", depositMemo: "memo-1", deadline: input.deadline, status: "PENDING_DEPOSIT" }), { status: 200, headers: { "x-request-id": "near-quote-request" } }));
    vi.stubEnv("REAL_PAYMENTS_ENABLED", "true");
    vi.stubEnv("NEAR_INTENTS_DRY_RUN", "false");
    const rail = new NearIntentsPaymentRail({ jwt: "test-jwt", apiUrl: "https://example.test/v0", originAssetId: "nep141:usdc.near", destinationAssetId: "nep141:usdc.omft.near", originDecimals: 24, destinationDecimals: 6, fetchImpl });
    const quote = await rail.createQuote(input).finally(() => vi.unstubAllEnvs());
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body));

    expect(fetchImpl).toHaveBeenCalledWith("https://example.test/v0/quote", expect.anything());
    expect(body.dry).toBe(true);
    expect(body.swapType).toBe("EXACT_INPUT");
    expect(body.amount).toBe("1250000000000000000000000000");
    expect(quote.estimatedReceivedMinor).toBe(12400);
    expect(quote.mode).toBe("REAL_DRY");
    expect(quote.quoteId).toBe("near-quote-1");
    expect(quote.depositAddress).toBeUndefined();
    expect(quote.depositMemo).toBeUndefined();
    expect(quote.depositRequirements).toBeUndefined();
    expect(quote.requestId).toBe("near-quote-request");
  });

  it("uses destination atomic units for an exact-output NEAR to Base preview", async () => {
    const tokens = [
      { assetId: "near-usdc", blockchain: "near", symbol: "USDC", decimals: 8 },
      { assetId: "base-usdc", blockchain: "base", symbol: "USDC", decimals: 6 },
    ];
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(tokens))
      .mockResolvedValueOnce(Response.json({ quote: { amountOut: "1250000000" } }));
    const rail = new NearIntentsPaymentRail({
      jwt: "test-jwt", apiUrl: "https://example.test/v0",
      originAssetId: "near-usdc", destinationAssetId: "base-usdc",
      originDecimals: 8, destinationDecimals: 6, pilotPreview: true, fetchImpl,
    });
    const quote = await rail.createQuote({ ...input, destinationChain: "base", refundDestination: "treasury.near" });

    expect(fetchImpl.mock.calls[0][0]).toBe("https://example.test/v0/tokens");
    expect(JSON.parse(String(fetchImpl.mock.calls[1][1]?.body))).toMatchObject({
      dry: true, swapType: "EXACT_OUTPUT", amount: "1250000000",
    });
    expect(quote.estimatedReceivedMinor).toBe(input.amountMinor);
  });
});
