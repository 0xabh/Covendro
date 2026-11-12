import type { FastifyInstance } from "fastify";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { getDemoUser } from "../repositories/organization-repository.js";

function getUserEmail(request: { headers: Record<string, unknown> }) {
  const header = request.headers["x-demo-user-email"];
  return typeof header === "string" && header.length > 0 ? header : "treasury@covendro.local";
}

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
    const user = await getDemoUser(getUserEmail(request));
    if (!user) throw new ApiError(401, "DEMO_USER_NOT_FOUND", "Choose a seeded demo user before continuing");
    const [treasuryIdentity] = await prisma.treasuryIdentity.findMany({ where: { organizationId: user.organizationId }, orderBy: { createdAt: "asc" }, take: 1 });
    const forceMocks = process.env.COVENDRO_FORCE_MOCKS === "true";
    const aiConfigured = Boolean(process.env.NEAR_AI_CLOUD_API_KEY) && !forceMocks;
    const intentsConfigured = Boolean(process.env.NEAR_INTENTS_JWT && process.env.NEAR_INTENTS_ORIGIN_ASSET_ID && process.env.NEAR_INTENTS_DESTINATION_ASSET_ID) && !forceMocks;
    const accountId = process.env.NEAR_TREASURY_ACCOUNT_ID || treasuryIdentity?.nearAccountId || null;
    const shouldVerify = request.query.verifyAccount === "true" && Boolean(process.env.NEAR_TREASURY_ACCOUNT_ID) && !forceMocks;
    const accountVerification = shouldVerify
      ? await verifyNearAccount(process.env.NEAR_TREASURY_ACCOUNT_ID!, process.env.NEAR_TREASURY_RPC_URL || "https://rpc.mainnet.near.org")
      : { state: process.env.NEAR_TREASURY_ACCOUNT_ID ? "NOT_REQUESTED" : "DEMO_IDENTITY" };
    return {
      data: {
        ai: { configured: aiConfigured, provider: aiConfigured ? "NearAICloudProvider" : "MockInvoiceAIProvider", model: process.env.NEAR_AI_CLOUD_MODEL || "google/gemini-2.5-flash-lite", verificationState: aiConfigured ? "UNVERIFIED" : "MOCKED" },
        intents: { configured: intentsConfigured, provider: intentsConfigured ? "NearIntentsPaymentRail" : "MockPaymentRail", mode: intentsConfigured ? "REAL_DRY" : "MOCK", executionEnabled: process.env.REAL_PAYMENTS_ENABLED === "true" && process.env.NEAR_INTENTS_DRY_RUN === "false" },
        treasury: { accountId, identityName: treasuryIdentity?.name ?? "No treasury identity", keyType: treasuryIdentity?.keyType ?? "FUNCTION_CALL", permissionScope: treasuryIdentity?.accessKeyPermissionScope ?? "No transfer authority stored", accountVerification },
      },
    };
  });
}
