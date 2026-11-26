import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { lockTreasuryWorkspace } from "../services/treasury-lock.js";
import { requireWorkspaceUser } from "../services/workspace-access.js";

const destinationSchema = z.discriminatedUnion("chain", [
  z.object({ chain: z.literal("near"), address: z.string().regex(/^(?!.*\.testnet$)(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/) }),
  z.object({ chain: z.literal("base"), address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).transform((address) => address.toLowerCase()).refine((address) => !/^0x0+$/.test(address)) }),
]);

export function registerVendorDestinationRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: unknown }>("/api/vendors/:id/destinations", async (request, reply) => {
    if (process.env.DEMO_MODE !== "false") throw new ApiError(404, "ROUTE_UNAVAILABLE", "Vendor destination verification requires a pilot workspace");
    const user = await requireWorkspaceUser(request);
    if (!["REVIEWER", "TREASURY_ADMINISTRATOR"].includes(user.role)) {
      throw new ApiError(403, "DESTINATION_REVIEWER_REQUIRED", "A reviewer or treasury administrator must propose the destination");
    }
    const parsed = destinationSchema.safeParse(request.body);
    if (!parsed.success) throw new ApiError(422, "DESTINATION_INVALID", "Enter a valid destination for the selected pilot chain");
    const destination = await prisma.$transaction(async (tx) => {
      const vendor = await tx.vendor.findFirst({ where: { id: request.params.id, organizationId: user.organizationId } });
      if (!vendor) throw new ApiError(404, "VENDOR_NOT_FOUND", "Vendor was not found");
      const record = await tx.vendorDestination.create({
        data: { vendorId: vendor.id, ...parsed.data, proposedById: user.id },
      });
      await tx.auditEvent.create({ data: {
        organizationId: user.organizationId, actorId: user.id, eventType: "VENDOR_DESTINATION_PROPOSED",
        description: "Vendor destination proposed for independent verification", requestId: request.id,
        metadataJson: JSON.stringify({ vendorId: vendor.id, destinationId: record.id }),
      } });
      return record;
    });
    return reply.code(201).send({ data: destination });
  });

  for (const action of ["verify", "revoke"] as const) {
    app.post<{ Params: { id: string; destinationId: string }; Body: unknown }>(
      `/api/vendors/:id/destinations/:destinationId/${action}`,
      async (request) => {
        if (process.env.DEMO_MODE !== "false") throw new ApiError(404, "ROUTE_UNAVAILABLE", "Vendor destination verification requires a pilot workspace");
        const user = await requireWorkspaceUser(request);
        if (user.role !== "TREASURY_ADMINISTRATOR") {
          throw new ApiError(403, "TREASURY_ADMIN_REQUIRED", "Treasury administration is required");
        }
        if (action === "verify" && !z.object({ confirmedWithKnownContact: z.literal(true) }).safeParse(request.body).success) {
          throw new ApiError(422, "CONTACT_CONFIRMATION_REQUIRED", "Confirm the destination through a known vendor contact");
        }
        const destination = await prisma.$transaction(async (tx) => {
          await lockTreasuryWorkspace(tx, user.organizationId);
          const current = await tx.vendorDestination.findFirst({ where: {
            id: request.params.destinationId, vendorId: request.params.id, vendor: { organizationId: user.organizationId },
          } });
          if (!current) throw new ApiError(404, "DESTINATION_NOT_FOUND", "Vendor destination was not found");
          if (action === "verify" && current.proposedById === user.id) {
            throw new ApiError(403, "INDEPENDENT_VERIFICATION_REQUIRED", "A different user must verify the destination");
          }
          const now = new Date();
          const updated = await tx.vendorDestination.updateMany({
            where: { id: current.id, revokedAt: null, ...(action === "verify" ? { verifiedAt: null } : {}) },
            data: action === "verify" ? { verifiedAt: now, verifiedById: user.id } : { revokedAt: now },
          });
          if (updated.count !== 1) throw new ApiError(409, "DESTINATION_STATE_CHANGED", "Vendor destination has already changed");
          await tx.auditEvent.create({ data: {
            organizationId: user.organizationId, actorId: user.id,
            eventType: action === "verify" ? "VENDOR_DESTINATION_VERIFIED" : "VENDOR_DESTINATION_REVOKED",
            description: action === "verify" ? "Vendor destination confirmed through an established contact" : "Vendor destination revoked",
            requestId: request.id, metadataJson: JSON.stringify({ vendorId: current.vendorId, destinationId: current.id }),
          } });
          return tx.vendorDestination.findUniqueOrThrow({ where: { id: current.id } });
        });
        return { data: destination };
      },
    );
  }
}
