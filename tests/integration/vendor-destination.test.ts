import { expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { prisma } from "../../apps/api/src/db/prisma.js";
import { credentialDigest, generateCredential } from "../../apps/api/src/services/workspace-access.js";

it("requires independent, tenant-scoped vendor destination verification", async () => {
  const origin = "https://covendro.example";
  vi.stubEnv("WEB_ORIGIN", origin);
  vi.stubEnv("DEMO_MODE", "false");
  const app = buildApp();
  const organization = await prisma.organization.create({ data: {
    slug: "vendor-destination-test",
    name: "Vendor Destination Test",
    vendors: { create: { name: "Vendor", accountAddress: "vendor.near" } },
  }, include: { vendors: true } });
  const other = await prisma.organization.create({ data: { slug: "vendor-other-test", name: "Other workspace" } });
  try {
    async function actor(email: string, role: string, organizationId: string) {
      const token = generateCredential();
      await prisma.user.create({ data: {
        name: email, email, role, organizationId,
        workspaceCredentials: { create: { digest: credentialDigest(token), purpose: "SESSION", expiresAt: new Date(Date.now() + 60_000) } },
      } });
      return { origin, cookie: `__Host-covendro=${token}` };
    }
    const proposer = await actor("proposer@vendor.example", "TREASURY_ADMINISTRATOR", organization.id);
    const verifier = await actor("verifier@vendor.example", "TREASURY_ADMINISTRATOR", organization.id);
    const stranger = await actor("stranger@vendor.example", "TREASURY_ADMINISTRATOR", other.id);
    const url = `/api/vendors/${organization.vendors[0].id}/destinations`;
    const payload = { chain: "base", address: "0xABCDEF0000000000000000000000000000000001" };

    expect((await app.inject({ method: "POST", url, headers: stranger, payload })).statusCode).toBe(404);
    const proposed = await app.inject({ method: "POST", url, headers: proposer, payload });
    expect(proposed.statusCode).toBe(201);
    const destination = proposed.json().data;
    expect(destination.address).toBe(payload.address.toLowerCase());
    const verify = { method: "POST" as const, url: `${url}/${destination.id}/verify`, payload: { confirmedWithKnownContact: true } };
    expect((await app.inject({ ...verify, headers: proposer })).statusCode).toBe(403);
    expect((await app.inject({ ...verify, headers: stranger })).statusCode).toBe(404);
    expect((await app.inject({ ...verify, headers: verifier, payload: {} })).statusCode).toBe(422);
    const verified = await app.inject({ ...verify, headers: verifier });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().data.verifiedAt).toEqual(expect.any(String));
    expect((await app.inject({ method: "POST", url: `${url}/${destination.id}/revoke`, headers: verifier })).statusCode).toBe(200);
    expect((await app.inject({ ...verify, headers: verifier })).statusCode).toBe(409);
    const events = await prisma.auditEvent.findMany({ where: { organizationId: organization.id } });
    expect(events.map((event) => event.eventType)).toEqual(expect.arrayContaining([
      "VENDOR_DESTINATION_PROPOSED", "VENDOR_DESTINATION_VERIFIED", "VENDOR_DESTINATION_REVOKED",
    ]));
  } finally {
    await prisma.organization.deleteMany({ where: { id: { in: [organization.id, other.id] } } });
    await app.close();
    vi.unstubAllEnvs();
  }
});
