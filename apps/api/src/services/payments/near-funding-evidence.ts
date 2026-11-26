import { z } from "zod";
import { ApiError } from "../../errors.js";

export const nearTransactionHash = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const successStatus = z.object({ SuccessValue: z.string() });
const functionCall = z.object({
  FunctionCall: z.object({
    method_name: z.literal("ft_transfer"), args: z.string().max(4096), deposit: z.literal("1"),
  }),
});
const transfer = z.object({
  receiver_id: z.string(), amount: z.string(), memo: z.string().nullable().optional(),
}).strict();
const transferLog = z.object({
  standard: z.literal("nep141"), version: z.literal("1.0.0"), event: z.literal("ft_transfer"),
  data: z.array(z.object({
    old_owner_id: z.string(), new_owner_id: z.string(), amount: z.string(), memo: z.string().nullable().optional(),
  })),
});
const finalTransaction = z.object({
  final_execution_status: z.literal("FINAL"),
  status: successStatus,
  transaction: z.object({
    hash: nearTransactionHash, signer_id: z.string(), receiver_id: z.string(),
    actions: z.tuple([functionCall]),
  }),
  receipts_outcome: z.array(z.object({
    id: z.string(), block_hash: z.string(),
    outcome: z.object({ executor_id: z.string(), logs: z.array(z.string()), status: z.unknown() }),
  })),
});

function parseJson(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

async function nearRpc(method: string, params: object): Promise<unknown> {
  const url = process.env.NEAR_TREASURY_RPC_URL;
  if (!url?.startsWith("https://")) throw new ApiError(503, "NEAR_RPC_UNAVAILABLE", "Configure an HTTPS NEAR mainnet RPC endpoint");
  try {
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method, params, id: "covendro-origin-funding" }),
    });
    const payload = await response.json() as { result?: unknown; error?: unknown };
    if (!response.ok || payload.error || !payload.result) throw new Error("NEAR RPC did not return a result");
    return payload.result;
  } catch {
    throw new ApiError(503, "NEAR_FUNDING_EVIDENCE_UNAVAILABLE", "NEAR funding evidence is unavailable; the reservation remains active");
  }
}

export async function verifyNearFunding(input: {
  txHash: string; signerId: string; tokenContract: string; recipient: string; amountAtomic: string; memo: string | null;
}) {
  const network = z.object({ chain_id: z.literal("mainnet") }).safeParse(await nearRpc("status", {}));
  if (!network.success) throw new ApiError(503, "NEAR_RPC_NETWORK_MISMATCH", "The funding RPC must connect to NEAR mainnet");

  const raw = await nearRpc("tx", { tx_hash: input.txHash, sender_account_id: input.signerId, wait_until: "FINAL" });
  const parsed = finalTransaction.safeParse(raw);
  if (!parsed.success) throw new ApiError(409, "FUNDING_NOT_VERIFIED", "A finalized successful NEAR token transfer is required");

  const { transaction, receipts_outcome: receipts } = parsed.data;
  const args = transfer.safeParse(parseJson(Buffer.from(transaction.actions[0].FunctionCall.args, "base64").toString("utf8")));
  const matching = receipts.flatMap((receipt) => {
    if (receipt.outcome.executor_id !== input.tokenContract || !successStatus.safeParse(receipt.outcome.status).success) return [];
    return receipt.outcome.logs.flatMap((log) => {
      if (!log.startsWith("EVENT_JSON:")) return [];
      const event = transferLog.safeParse(parseJson(log.slice("EVENT_JSON:".length)));
      return event.success ? event.data.data.map((data) => ({ data, id: receipt.id, blockHash: receipt.block_hash })) : [];
    });
  });
  const evidence = matching.length === 1 ? matching[0] : undefined;
  if (transaction.hash !== input.txHash || transaction.signer_id !== input.signerId || transaction.receiver_id !== input.tokenContract ||
      !args.success || args.data.receiver_id !== input.recipient || args.data.amount !== input.amountAtomic ||
      (args.data.memo ?? null) !== input.memo || !evidence || evidence.data.old_owner_id !== input.signerId ||
      evidence.data.new_owner_id !== input.recipient || evidence.data.amount !== input.amountAtomic ||
      (evidence.data.memo ?? null) !== input.memo) {
    throw new ApiError(409, "FUNDING_EVIDENCE_MISMATCH", "The final transaction does not match the expected token transfer");
  }
  return { txHash: input.txHash, receiptId: evidence.id, blockHash: evidence.blockHash, amountAtomic: input.amountAtomic };
}
