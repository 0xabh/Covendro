import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { getDemoUser } from "../repositories/organization-repository.js";

const cookieName = "__Host-covendro";
const lifetimeSeconds = 8 * 60 * 60;
const roles = ["SUBMITTER", "REVIEWER", "TREASURY_SIGNER", "TREASURY_ADMINISTRATOR", "AUDITOR"];
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function credentialDigest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function generateCredential() {
  return randomBytes(32).toString("base64url");
}

export function sessionToken(request: FastifyRequest) {
  const cookie = request.headers.cookie?.split(";").map((part) => part.trim()).find((part) => part.startsWith(cookieName + "="));
  return cookie?.slice(cookieName.length + 1) ?? "";
}

function sessionCookie(token: string, seconds: number) {
  return `${cookieName}=${token}; Secure; HttpOnly; SameSite=Strict; Path=/; Max-Age=${seconds}`;
}

function requireBrowserOrigin(request: FastifyRequest) {
  if (!process.env.WEB_ORIGIN || request.headers.origin !== process.env.WEB_ORIGIN) {
    throw new ApiError(403, "INVALID_ORIGIN", "The request must originate from the configured Covendro web app");
  }
}

function isPilotMember(user: { email: string; role: string; organization: { slug: string } }) {
  return user.organization.slug !== "covendro-demo" && !user.email.endsWith("@covendro.local") && roles.includes(user.role);
}

export async function requireWorkspaceUser(request: FastifyRequest, fallback = "submitter@covendro.local") {
  if (process.env.DEMO_MODE === "false") {
    const token = sessionToken(request);
    if (tokenPattern.test(token)) {
      const credential = await prisma.workspaceCredential.findUnique({
        where: { digest: credentialDigest(token) },
        include: { user: { include: { organization: true } } },
      });
      if (credential?.purpose === "SESSION" && credential.expiresAt > new Date() && isPilotMember(credential.user)) {
        return credential.user;
      }
    }
    throw new ApiError(401, "SESSION_REQUIRED", "Sign in with a valid workspace session");
  }

  const header = request.headers["x-demo-user-email"];
  const user = await getDemoUser(typeof header === "string" && header.length > 0 ? header : fallback);
  if (!user || user.organization.slug !== "covendro-demo") {
    throw new ApiError(401, "DEMO_USER_NOT_FOUND", "Choose a seeded demo user before continuing");
  }
  return user;
}

export function registerWorkspaceAccess(app: FastifyInstance) {
  app.addHook("onRequest", async (request, reply) => {
    if (process.env.DEMO_MODE !== "false" || !request.routeOptions.url?.startsWith("/api/")) return;
    reply.header("cache-control", "no-store");
    const route = request.routeOptions.url;
    if (request.method !== "GET" && request.method !== "HEAD") requireBrowserOrigin(request);
    if (route === "/api/session" && request.method === "POST") return;
    const user = await requireWorkspaceUser(request);
    if (route.startsWith("/api/invoices/fixtures") || route.endsWith("/simulate")) {
      throw new ApiError(404, "ROUTE_UNAVAILABLE", "This route is available in the demo workspace");
    }
    if (user.role === "AUDITOR" && !["GET", "HEAD", "DELETE"].includes(request.method)) {
      throw new ApiError(403, "READ_ONLY_ROLE", "Auditors have read-only access");
    }
  });

  app.post<{ Body: { invite?: unknown } }>("/api/session", async (request, reply) => {
    if (process.env.DEMO_MODE !== "false") throw new ApiError(404, "ROUTE_UNAVAILABLE", "Workspace sessions are available in pilot mode");
    const invite = request.body?.invite;
    if (typeof invite !== "string" || !tokenPattern.test(invite)) {
      throw new ApiError(401, "INVALID_INVITE", "Enter an active workspace invite");
    }
    const token = generateCredential();
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const digest = credentialDigest(invite);
      const credential = await tx.workspaceCredential.findUnique({
        where: { digest },
        include: { user: { include: { organization: true } } },
      });
      if (!credential || credential.purpose !== "INVITE" || credential.expiresAt <= now || !isPilotMember(credential.user)) {
        throw new ApiError(401, "INVALID_INVITE", "Enter an active workspace invite");
      }
      const consumed = await tx.workspaceCredential.deleteMany({ where: { digest, purpose: "INVITE", expiresAt: { gt: now } } });
      if (consumed.count !== 1) throw new ApiError(401, "INVALID_INVITE", "Enter an active workspace invite");
      await tx.workspaceCredential.create({
        data: { digest: credentialDigest(token), userId: credential.userId, purpose: "SESSION", expiresAt: new Date(now.getTime() + lifetimeSeconds * 1000) },
      });
    });
    return reply.header("set-cookie", sessionCookie(token, lifetimeSeconds)).code(204).send();
  });

  app.get("/api/session", async (request) => {
    const user = await requireWorkspaceUser(request);
    return { data: { name: user.name, role: user.role, workspace: user.organization.name } };
  });

  app.delete("/api/session", async (request, reply) => {
    if (process.env.DEMO_MODE !== "false") throw new ApiError(404, "ROUTE_UNAVAILABLE", "Workspace sessions are available in pilot mode");
    await prisma.workspaceCredential.deleteMany({ where: { digest: credentialDigest(sessionToken(request)), purpose: "SESSION" } });
    return reply.header("set-cookie", sessionCookie("", 0)).code(204).send();
  });
}
