import "dotenv/config";
import { prisma } from "./db/prisma.js";
import { buildApp } from "./app.js";

const app = buildApp();
const port = Number(process.env.API_PORT ?? 4000);

try {
  if (process.env.NODE_ENV === "production" && process.env.DEMO_MODE === "false") {
    if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL ?? "")) {
      throw new Error("A PostgreSQL database is required for the production pilot");
    }
    const origin = process.env.WEB_ORIGIN ?? "";
    if (!origin.startsWith("https://") || new URL(origin).origin !== origin) {
      throw new Error("Configure the exact HTTPS web origin for the production pilot");
    }
    if (await prisma.organization.findUnique({ where: { slug: "covendro-demo" }, select: { id: true } })) {
      throw new Error("The production pilot database contains demo seed data");
    }
  }
  await app.listen({ port, host: "0.0.0.0" });
} catch (error) {
  if (process.env.NODE_ENV === "production") {
    process.stderr.write("Covendro API startup failed. Verify runtime configuration and migrations.\n");
  } else {
    app.log.error(error);
  }
  process.exit(1);
}
