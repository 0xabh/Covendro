import { ApiError } from "../errors.js";

export function treasuryProofBinding(treasuryIdentityId: string, sessionDigest: string) {
  return `TREASURY_VERIFIED:${treasuryIdentityId}:${sessionDigest}:`;
}

export async function hasMainnetFullAccessKey(accountId: string, publicKey: string) {
  const url = process.env.NEAR_TREASURY_RPC_URL ?? "";
  if (!url.startsWith("https://")) {
    throw new ApiError(503, "NEAR_RPC_UNAVAILABLE", "Configure an HTTPS NEAR mainnet RPC endpoint");
  }
  async function rpc(method: string, params: object) {
    const response = await fetch(url, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "covendro-treasury-proof", method, params }),
    });
    if (!response.ok) throw new Error("NEAR RPC request failed");
    return await response.json() as { result?: { chain_id?: string; permission?: unknown }; error?: unknown };
  }
  try {
    const status = await rpc("status", {});
    if (status.result?.chain_id !== "mainnet") return false;
    const key = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: accountId, public_key: publicKey });
    return key.result?.permission === "FullAccess";
  } catch {
    throw new ApiError(503, "NEAR_RPC_UNAVAILABLE", "NEAR mainnet key verification is temporarily unavailable");
  }
}
