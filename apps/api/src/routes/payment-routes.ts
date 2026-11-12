import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getDemoUser } from "../repositories/organization-repository.js";
import { ApiError } from "../errors.js";
import { getPaymentRail } from "../services/payments/payment-rail-factory.js";
import { createPaymentQuote, findPayment, listPayments, simulatePayment } from "../services/payment-service.js";

const simulationSchema = z.object({ outcome: z.enum(["SUCCESS", "REFUNDED", "FAILED", "EXPIRED"]) });

function getUserEmail(request: { headers: Record<string, unknown> }) {
  const header = request.headers["x-demo-user-email"];
  return typeof header === "string" && header.length > 0 ? header : "submitter@covendro.local";
}

async function requireUser(request: { headers: Record<string, unknown> }) {
  const user = await getDemoUser(getUserEmail(request));
  if (!user) throw new ApiError(401, "DEMO_USER_NOT_FOUND", "Choose a seeded demo user before continuing");
  return user;
}

function idempotencyKey(request: { headers: Record<string, unknown> }) {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function registerPaymentRoutes(app: FastifyInstance) {
  app.get("/api/payments", async (request) => {
    const user = await requireUser(request);
    return { data: await listPayments(user.organizationId) };
  });

  app.get("/api/payments/supported-assets", async () => ({ data: await getPaymentRail().getSupportedAssets() }));

  app.get<{ Params: { id: string } }>("/api/payments/:id", async (request) => {
    const user = await requireUser(request);
    return { data: await findPayment(request.params.id, user.organizationId) };
  });

  app.post<{ Params: { id: string } }>("/api/invoices/:id/quote", async (request) => {
    const user = await requireUser(request);
    return { data: await createPaymentQuote(request.params.id, user, request.id, idempotencyKey(request)) };
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/payments/:id/simulate", async (request) => {
    const parsed = simulationSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(422, "SIMULATION_VALIDATION_FAILED", "Choose a supported mock outcome", parsed.error.issues);
    const user = await requireUser(request);
    return { data: await simulatePayment(request.params.id, user, parsed.data.outcome, request.id) };
  });
}
