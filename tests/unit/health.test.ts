import { describe, expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";

describe("GET /health", () => {
  it("returns an explicit demo-mode health response", async () => {
    const app = buildApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      service: "covendro-api",
      demoMode: true,
      database: "default-local",
    });
    expect(response.json().requestId).toEqual(expect.any(String));

    await app.close();
  });

  it("keeps demo routes unavailable when demo mode is disabled", async () => {
    vi.stubEnv("DEMO_MODE", "false");
    const app = buildApp();
    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/ledger.csv",
        headers: { "x-demo-user-email": "treasury@covendro.local" },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe("SESSION_REQUIRED");
      expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
    } finally {
      await app.close();
      vi.unstubAllEnvs();
    }
  });
});
