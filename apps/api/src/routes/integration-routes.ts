import type { FastifyInstance } from "fastify";
import { ApiError } from "../errors.js";
import { prisma } from "../db/prisma.js";
import { getPaymentRail } from "../services/payments/payment-rail-factory.js";
import { requireWorkspaceUser } from "../services/workspace-access.js";

async function verifyNearAccount(accountId: string, rpcUrl: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const request = (requestType: string) => fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "covendro", method: "query", params: { request_type: requestType, finality: "final", account_id: accountId } }),
      signal: controller.signal,
    });
    const accountResponse = await request("view_account");
    const accountBody = await accountResponse.json() as { error?: unknown; result?: { amount?: string } };
    if (!accountResponse.ok || accountBody.error || !accountBody.result) return { state: "UNAVAILABLE", reason: "The configured account could not be read from the selected NEAR RPC." };
    const keysResponse = await request("view_access_key_list");
    const keysBody = await keysResponse.json() as { result?: { keys?: unknown[] } };
    return { state: "VERIFIED", accessKeyCount: keysBody.result?.keys?.length ?? null };
  } catch {
    return { state: "UNAVAILABLE", reason: "The NEAR RPC did not respond within five seconds." };
  } finally {
    clearTimeout(timeout);
  }
}

export function registerIntegrationRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { verifyAccount?: string } }>("/api/integrations/status", async (request) => {
    const user = await requireWorkspaceUser(request, "treasury@covendro.local");
    const [treasuryIdentity] = await prisma.treasuryIdentity.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "asc" }, take: 1 });
    const pilotMode = process.env.DEMO_MODE === "false";
    const forceMocks = process.env.COVENDRO_FORCE_MOCKS === "true";
    const aiConfigured = !pilotMode && Boolean(process.env.NEAR_AI_CLOUD_API_KEY) && !forceMocks;
    let paymentRail;
    try {
      paymentRail = getPaymentRail();
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== "PAYMENT_RAIL_UNAVAILABLE") throw error;
    }
    const configuredDemoAccount = pilotMode ? undefined : process.env.NEAR_TREASURY_ACCOUNT_ID;
    const accountId = configuredDemoAccount || treasuryIdentity?.nearAccountId || null;
    const shouldVerify = request.query.verifyAccount === "true" && Boolean(configuredDemoAccount) && !forceMocks;
    const accountVerification = shouldVerify
      ? await verifyNearAccount(configuredDemoAccount!, process.env.NEAR_TREASURY_RPC_URL || "https://rpc.mainnet.near.org")
      : { state: pilotMode ? "NOT_VERIFIED" : configuredDemoAccount ? "NOT_REQUESTED" : "DEMO_IDENTITY" };
    return {
      data: {
        ai: { configured: aiConfigured, provider: pilotMode ? "Manual confirmation" : aiConfigured ? "NearAICloudProvider" : "MockInvoiceAIProvider", model: pilotMode ? null : process.env.NEAR_AI_CLOUD_MODEL || "google/gemini-2.5-flash-lite", verificationState: pilotMode ? "MANUAL" : aiConfigured ? "UNVERIFIED" : "MOCKED" },
        intents: { configured: paymentRail?.mode === "REAL_DRY", provider: paymentRail?.name ?? "Unavailable", mode: paymentRail?.mode ?? "UNAVAILABLE", executionEnabled: false },
        treasury: { accountId, identityName: treasuryIdentity?.name ?? "No treasury identity", keyType: treasuryIdentity?.keyType ?? "FUNCTION_CALL", permissionScope: treasuryIdentity?.accessKeyPermissionScope ?? "No transfer authority stored", accountVerification },
      },
    };
  });
}
