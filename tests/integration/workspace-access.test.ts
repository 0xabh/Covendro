import { expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { prisma } from "../../apps/api/src/db/prisma.js";
import { credentialDigest, generateCredential } from "../../apps/api/src/services/workspace-access.js";

it("exchanges a workspace invite once, scopes reads and revokes the session on sign-out", async () => {
  const origin = "https://covendro.example";
  vi.stubEnv("WEB_ORIGIN", origin);
  vi.stubEnv("DEMO_MODE", "false");
  const app = buildApp();
  const invite = generateCredential();
  const pilot = await prisma.organization.create({ data: {
    slug: "workspace-access-test", name: "Pilot",
    users: { create: { name: "Test Auditor", email: "auditor@pilot.example", role: "AUDITOR" } },
  }, include: { users: true } });
  try {
    await prisma.workspaceCredential.create({ data: {
      digest: credentialDigest(invite), userId: pilot.users[0].id, purpose: "INVITE",
      expiresAt: new Date(Date.now() + 60_000),
    } });
    const login = { method: "POST" as const, url: "/api/session", headers: { origin }, payload: { invite } };
    expect((await app.inject({ ...login, headers: { origin: "https://wrong.example" } })).statusCode).toBe(403);
    const result = await app.inject(login);
    expect(result.statusCode).toBe(204);
    const setCookie = result.headers["set-cookie"] as string;
    expect(setCookie).toContain("Secure; HttpOnly; SameSite=Strict");
    const headers = { cookie: setCookie.split(";")[0], origin, "x-demo-user-email": "treasury@covendro.local" };
    expect((await app.inject(login)).statusCode).toBe(401);
    const session = await app.inject({ method: "GET", url: "/api/session", headers });
    expect(session.json().data).toMatchObject({ role: "AUDITOR", workspace: "Pilot" });
    const invoices = await app.inject({ method: "GET", url: "/api/invoices", headers });
    expect(invoices.json().data).toEqual([]);
    expect((await app.inject({ method: "POST", url: "/api/invoices", headers, payload: {} })).statusCode).toBe(403);
    expect((await app.inject({ method: "DELETE", url: "/api/session", headers })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/api/session", headers })).statusCode).toBe(401);
  } finally {
    await prisma.organization.delete({ where: { id: pilot.id } });
    await app.close();
    vi.unstubAllEnvs();
  }
});
