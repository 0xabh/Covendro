import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { credentialDigest, requireWorkspaceUser, sessionToken } from "../services/workspace-access.js";
import { prisma } from "../db/prisma.js";
import { nearTransactionHash } from "../services/payments/near-funding-evidence.js";
import { confirmLiveFunding, prepareLiveAttempt, handoffLiveAttempt, requireLiveSigner, summarizeAttempt } from "../services/payments/live-payment-service.js";
import { ApiError } from "../errors.js";
import { getPaymentRail } from "../services/payments/payment-rail-factory.js";
import { createPaymentQuote, findPayment, listPayments, simulatePayment } from "../services/payment-service.js";

const simulationSchema = z.object({ outcome: z.enum(["SUCCESS", "REFUNDED", "FAILED", "EXPIRED"]) });


function idempotencyKey(request: { headers: Record<string, unknown> }) {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function registerPaymentRoutes(app: FastifyInstance) {
  app.get("/api/payments", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    return { data: await listPayments(user.organizationId) };
  });

  app.get("/api/payments/supported-assets", async () => ({ data: await getPaymentRail().getSupportedAssets() }));

  app.get<{ Params: { id: string } }>("/api/payments/:id", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    return { data: await findPayment(request.params.id, user.organizationId) };
  });

  app.post<{ Params: { id: string } }>("/api/invoices/:id/quote", async (request) => {
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    return { data: await createPaymentQuote(request.params.id, user, request.id, idempotencyKey(request)) };
  });

  app.get<{ Params: { id: string } }>("/api/invoices/:id/live-attempt", async (request) => {
    const user = await requireWorkspaceUser(request);
    requireLiveSigner(user);
    const attempt = await prisma.livePaymentAttempt.findFirst({
      where: { activeInvoiceId: request.params.id, organizationId: user.organizationId },
    });
    return { data: attempt ? summarizeAttempt(attempt) : null, walletHandoffEnabled: process.env.PILOT_ENABLE_WALLET_HANDOFF === "true" };
  });

  app.post<{ Params: { id: string } }>("/api/invoices/:id/live-attempt", async (request) => {
    const user = await requireWorkspaceUser(request);
    return { data: await prepareLiveAttempt(request.params.id, user, request.id) };
  });

  app.post<{ Params: { id: string } }>("/api/live-attempts/:id/wallet-handoff", async (request) => {
    const user = await requireWorkspaceUser(request);
    return { data: await handoffLiveAttempt(request.params.id, user, credentialDigest(sessionToken(request)), request.id) };
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/live-attempts/:id/funding", async (request) => {
    const user = await requireWorkspaceUser(request);
    const parsed = z.object({ txHash: nearTransactionHash }).safeParse(request.body);
    if (!parsed.success) throw new ApiError(422, "FUNDING_HASH_INVALID", "Provide a NEAR transaction hash");
    return { data: await confirmLiveFunding(request.params.id, parsed.data.txHash, user, request.id) };
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/payments/:id/simulate", async (request) => {
    const parsed = simulationSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(422, "SIMULATION_VALIDATION_FAILED", "Choose a supported mock outcome", parsed.error.issues);
    const user = await requireWorkspaceUser(request, "submitter@covendro.local");
    return { data: await simulatePayment(request.params.id, user, parsed.data.outcome, request.id) };
  });
}
