import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import type { HealthResponse } from "@covendro/shared";
import { prisma } from "./db/prisma.js";
import { ApiError } from "./errors.js";
import { registerInvoiceRoutes } from "./routes/invoice-routes.js";
import { registerTreasuryRoutes } from "./routes/treasury-routes.js";
import { registerWorkflowRoutes } from "./routes/workflow-routes.js";
import { registerPaymentRoutes } from "./routes/payment-routes.js";
import { registerReportingRoutes } from "./routes/reporting-routes.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });
  app.register(cors, { origin: true });

  app.get<{ Reply: HealthResponse }>("/health", async (request) => ({
    status: "ok",
    service: "covendro-api",
    demoMode: process.env.DEMO_MODE !== "false",
    database: process.env.COVENDRO_FORCE_MOCKS === "true" ? "default-local" : process.env.DATABASE_URL ? "configured" : "default-local",
    requestId: request.id,
  }));

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.status(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id,
      });
    }

    // Do not log the raw error object: parser/provider errors can accidentally
    // contain document or provider response data. The request ID remains
    // available to correlate the client-safe error response.
    request.log.error({ requestId: request.id, errorName: error instanceof Error ? error.name : "UnknownError" }, "Unhandled API error");
    return reply.status(500).send({
      error: { code: "INTERNAL_SERVER_ERROR", message: "An unexpected error occurred" },
      requestId: request.id,
    });
  });

  registerInvoiceRoutes(app);
  registerTreasuryRoutes(app);
  registerWorkflowRoutes(app);
  registerPaymentRoutes(app);
  registerReportingRoutes(app);

  return app;
}
