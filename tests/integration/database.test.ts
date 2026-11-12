import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { getOrganizationSnapshot } from "../../apps/api/src/repositories/organization-repository.js";

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./dev.db" },
  },
});

describe("seeded database", () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("loads the seeded organization, demo roles, vendors, and active policy", async () => {
    const snapshot = await getOrganizationSnapshot("covendro-demo");

    expect(snapshot?.name).toBe("Covendro Demo Treasury");
    expect(snapshot?.users.map((user) => user.role)).toEqual([
      "TREASURY_ADMINISTRATOR",
      "REVIEWER",
      "SUBMITTER",
    ]);
    expect(snapshot?.vendors).toHaveLength(2);
    expect(snapshot?.policies[0]).toMatchObject({
      version: 1,
      demoMode: true,
      freezePayments: false,
      allowedCurrenciesCsv: "USDC,USDT",
    });
  });
});
