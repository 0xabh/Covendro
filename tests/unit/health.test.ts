import { describe, expect, it } from "vitest";
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
});
