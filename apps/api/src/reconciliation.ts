import "dotenv/config";
import { setTimeout as delay } from "node:timers/promises";
import { prisma } from "./db/prisma.js";
import { reconcileDuePayments } from "./services/payments/reconciliation-worker.js";

if (process.env.DEMO_MODE !== "false" || !/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
  throw new Error("Reconciliation requires the pilot PostgreSQL database");
}

const shutdown = new AbortController();
process.once("SIGINT", () => shutdown.abort());
process.once("SIGTERM", () => shutdown.abort());

try {
  while (!shutdown.signal.aborted) {
    try {
      await reconcileDuePayments();
    } catch {
      process.stderr.write("Covendro reconciliation loop failed; will retry.\n");
    }
    await delay(5_000, undefined, { signal: shutdown.signal }).catch(() => undefined);
  }
} finally {
  await prisma.$disconnect();
}
