import { quoteHash, verifyQuoteSignature, type QuoteResponse } from "@defuse-protocol/one-click-sdk-typescript";
import type { LivePaymentAttempt } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "../../errors.js";

const atomic = z.string().regex(/^(0|[1-9][0-9]{0,38})$/);
const evmHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const evmAddress = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const quantity = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/);
const txHashes = z.array(z.object({ hash: z.string().max(128) })).max(20).optional();
const transferTopic = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const rawStatus = z.object({
  status: z.enum(["PENDING_DEPOSIT", "KNOWN_DEPOSIT_TX", "INCOMPLETE_DEPOSIT", "PROCESSING", "SUCCESS", "REFUNDED", "FAILED"]),
  quoteResponse: z.unknown(),
  swapDetails: z.object({
    nearTxHashes: z.array(z.string().max(128)).max(20).optional(),
    originChainTxHashes: txHashes,
    destinationChainTxHashes: txHashes,
    amountIn: atomic.optional(),
    depositedAmount: atomic.optional(),
    refundedAmount: atomic.optional(),
  }).optional(),
});

export async function readProviderStatus(attempt: LivePaymentAttempt) {
  const apiKey = process.env.NEAR_INTENTS_API_KEY;
  if (!apiKey) throw new ApiError(503, "PROVIDER_CONFIG_MISSING", "Configure the 1Click partner credential");
  const params = new URLSearchParams({ depositAddress: attempt.depositAccountId });
  if (attempt.depositMemo) params.set("depositMemo", attempt.depositMemo);
  const response = await fetch("https://1click.chaindefuser.com/v0/status?" + params, {
    headers: { "X-API-Key": apiKey }, redirect: "error", signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new ApiError(503, "PROVIDER_STATUS_UNAVAILABLE", "1Click status is temporarily unavailable");
  const result = rawStatus.safeParse(await response.json());
  if (!result.success) throw new ApiError(503, "PROVIDER_STATUS_INVALID", "The 1Click status shape is unrecognized");
  const quote = result.data.quoteResponse as QuoteResponse;
  // The SDK signature binds the original quote. Transaction hints are verified against their chains.
  if (!verifyQuoteSignature(quote) || quoteHash(quote) !== attempt.quoteHash) {
    throw new ApiError(409, "PROVIDER_QUOTE_MISMATCH", "1Click status could not be bound to the original signed quote");
  }
  return result.data;
}

const receipt = z.object({
  transactionHash: evmHash, blockNumber: quantity, blockHash: evmHash, status: z.literal("0x1"),
  logs: z.array(z.object({ address: evmAddress, topics: z.array(evmHash), data: z.string().regex(/^0x(?:[0-9a-fA-F]{2})*$/).max(524290), removed: z.boolean().optional() })),
});
const block = z.object({ number: quantity, hash: evmHash });

export async function verifyBasePayout(input: { txHash: string; tokenContract: string; recipient: string; amountAtomic: string }) {
  const endpoint = process.env.BASE_MAINNET_RPC_URL;
  const payoutSender = evmAddress.safeParse(process.env.PILOT_BASE_PAYOUT_SENDER);
  if (!endpoint?.startsWith("https://") || !payoutSender.success) {
    throw new ApiError(503, "BASE_EVIDENCE_CONFIG_MISSING", "Configure a Base mainnet RPC and an approved payout sender");
  }
  async function rpc(method: string, params: unknown[]): Promise<unknown> {
    const response = await fetch(endpoint!, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: "covendro-base-evidence" }),
    });
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (!response.ok || payload.error) throw new ApiError(503, "BASE_RPC_UNAVAILABLE", "Base payment evidence is unavailable");
    return payload.result;
  }
  if (!evmHash.safeParse(input.txHash).success || await rpc("eth_chainId", []) !== "0x2105") {
    throw new ApiError(409, "BASE_NETWORK_OR_HASH_MISMATCH", "The payout requires a valid Base mainnet transaction");
  }
  const [payment, head] = await Promise.all([
    rpc("eth_getTransactionReceipt", [input.txHash]), rpc("eth_getBlockByNumber", ["finalized", false]),
  ]);
  if (!payment) throw new ApiError(503, "BASE_PAYOUT_NOT_FINAL", "Base payout evidence is not finalized yet");
  const parsed = receipt.safeParse(payment);
  const finalHead = block.safeParse(head);
  if (!parsed.success || !finalHead.success || parsed.data.transactionHash.toLowerCase() !== input.txHash.toLowerCase()) {
    throw new ApiError(409, "BASE_PAYOUT_INVALID", "The Base receipt does not match the payout transaction");
  }
  const record = parsed.data;
  if (BigInt(record.blockNumber) > BigInt(finalHead.data.number)) {
    throw new ApiError(503, "BASE_PAYOUT_NOT_FINAL", "Base payout evidence is not finalized yet");
  }
  const canonical = block.safeParse(await rpc("eth_getBlockByNumber", [record.blockNumber, false]));
  const addressTopic = (address: string) => "0x" + address.toLowerCase().slice(2).padStart(64, "0");
  const logs = record.logs.filter((log) =>
    !log.removed && log.address.toLowerCase() === input.tokenContract.toLowerCase() &&
    log.data.length === 66 && log.topics.length === 3 && log.topics[0].toLowerCase() === transferTopic &&
    log.topics[1].toLowerCase() === addressTopic(payoutSender.data) &&
    log.topics[2].toLowerCase() === addressTopic(input.recipient));
  if (!canonical.success || canonical.data.hash.toLowerCase() !== record.blockHash.toLowerCase() ||
      logs.length !== 1 || BigInt(logs[0].data) !== BigInt(input.amountAtomic)) {
    throw new ApiError(409, "BASE_PAYOUT_MISMATCH", "Finalized Base token delivery does not match the approved payable");
  }
  return { hash: record.transactionHash.toLowerCase(), blockHash: record.blockHash, amountAtomic: input.amountAtomic };
}
