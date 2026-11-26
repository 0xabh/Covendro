import { createHash, createPublicKey, verify } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { hasMainnetFullAccessKey, treasuryProofBinding } from "../services/treasury-proof.js";
import { prisma } from "../db/prisma.js";
import { ApiError } from "../errors.js";
import { credentialDigest, generateCredential, requireWorkspaceUser, sessionToken } from "../services/workspace-access.js";

const base58Alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const callbackMode = z.literal("my-near-wallet").optional();
const proofInput = z.object({
  wallet: callbackMode,
  nonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  accountId: z.string().min(2).max(64),
  publicKey: z.string().regex(/^ed25519:[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  signature: z.string().regex(/^[A-Za-z0-9+/]{86}==$/),
});

function uint32(value: number) {
  const bytes = Buffer.alloc(4);
  bytes.writeUInt32LE(value);
  return bytes;
}

function borshString(value: string) {
  const bytes = Buffer.from(value, "utf8");
  return Buffer.concat([uint32(bytes.length), bytes]);
}

export function treasuryProofDigest(message: string, nonce: Buffer, recipient: string, callbackUrl?: string) {
  return createHash("sha256").update(Buffer.concat([
    uint32(2 ** 31 + 413),
    borshString(message),
    nonce,
    borshString(recipient),
    ...(callbackUrl ? [Buffer.from([1]), borshString(callbackUrl)] : [Buffer.from([0])]),
  ])).digest();
}

function decodeKey(publicKey: string) {
  const encoded = publicKey.slice("ed25519:".length);
  let value = 0n;
  for (const char of encoded) value = value * 58n + BigInt(base58Alphabet.indexOf(char));
  const hex = value.toString(16);
  const raw = value === 0n ? Buffer.alloc(0) : Buffer.from(hex.length % 2 ? "0" + hex : hex, "hex");
  const leadingZeros = encoded.match(/^1*/)?.[0].length ?? 0;
  const key = Buffer.concat([Buffer.alloc(leadingZeros), raw]);
  if (key.length !== 32) throw new ApiError(422, "INVALID_PUBLIC_KEY", "The NEAR public key is malformed");
  return createPublicKey({
    format: "der", type: "spki",
    key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key]),
  });
}

async function proofContext(request: FastifyRequest, wallet?: "my-near-wallet") {
  if (process.env.DEMO_MODE !== "false") throw new ApiError(404, "ROUTE_UNAVAILABLE", "Treasury proof requires a pilot workspace");
  const user = await requireWorkspaceUser(request);
  if (user.role !== "TREASURY_SIGNER") throw new ApiError(403, "TREASURY_SIGNER_REQUIRED", "Treasury signer access is required");
  const treasury = await prisma.treasuryIdentity.findFirst({
    where: { organizationId: user.organizationId, demoIdentity: false },
  });
  if (!treasury) throw new ApiError(409, "PILOT_TREASURY_REQUIRED", "Configure the workspace treasury first");
  const session = credentialDigest(sessionToken(request));
  const webOrigin = new URL(process.env.WEB_ORIGIN!);
  const recipient = webOrigin.hostname;
  const callbackUrl = wallet ? new URL("/", webOrigin).href : undefined;
  return {
    user, treasury, session, recipient, callbackUrl,
    purpose: `TREASURY_CHALLENGE:${treasury.id}:${session}${callbackUrl ? ":my-near-wallet" : ""}`,
    message: `Verify Covendro treasury ownership on NEAR mainnet. Account: ${treasury.nearAccountId}. Workspace: ${user.organizationId}.`,
  };
}

export function registerTreasuryProofRoutes(app: FastifyInstance) {
  app.post<{ Body: unknown }>("/api/treasury/proof/challenge", async (request) => {
    const mode = z.object({ wallet: callbackMode }).safeParse(request.body ?? {});
    if (!mode.success) throw new ApiError(422, "TREASURY_WALLET_UNSUPPORTED", "Select a supported NEAR wallet");
    const { user, treasury, purpose, message, recipient, callbackUrl } = await proofContext(request, mode.data.wallet);
    const nonce = generateCredential();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await prisma.$transaction([
      prisma.workspaceCredential.deleteMany({ where: { userId: user.id, purpose } }),
      prisma.workspaceCredential.create({ data: { digest: credentialDigest(nonce), userId: user.id, purpose, expiresAt } }),
    ]);
    return { data: { accountId: treasury.nearAccountId, network: "mainnet", message, recipient, callbackUrl, nonce, expiresAt } };
  });

  app.post<{ Body: unknown }>("/api/treasury/proof", async (request) => {
    const parsed = proofInput.safeParse(request.body);
    if (!parsed.success) throw new ApiError(422, "TREASURY_PROOF_INVALID", "Provide a signed challenge for the approved mainnet account");
    const { user, treasury, session, purpose, message, recipient, callbackUrl } = await proofContext(request, parsed.data.wallet);
    if (parsed.data.accountId !== treasury.nearAccountId) {
      throw new ApiError(422, "TREASURY_PROOF_INVALID", "Provide a signed challenge for the approved mainnet account");
    }
    const { nonce, accountId, publicKey, signature } = parsed.data;
    const digest = credentialDigest(nonce);
    const challenge = await prisma.workspaceCredential.findFirst({ where: { digest, userId: user.id, purpose, expiresAt: { gt: new Date() } } });
    if (!challenge) throw new ApiError(409, "TREASURY_CHALLENGE_EXPIRED", "Request a new wallet challenge");
    const hash = treasuryProofDigest(message, Buffer.from(nonce, "base64url"), recipient, callbackUrl);
    if (!verify(null, hash, decodeKey(publicKey), Buffer.from(signature, "base64")) || !await hasMainnetFullAccessKey(accountId, publicKey)) {
      throw new ApiError(403, "TREASURY_PROOF_REJECTED", "The signature must use an active full-access key for the approved mainnet account");
    }
    const verifiedAt = new Date();
    await prisma.$transaction(async (tx) => {
      const consumed = await tx.workspaceCredential.deleteMany({ where: { digest, userId: user.id, purpose, expiresAt: { gt: verifiedAt } } });
      if (consumed.count !== 1) throw new ApiError(409, "TREASURY_CHALLENGE_EXPIRED", "Request a new wallet challenge");
      const activeSession = await tx.workspaceCredential.findFirst({ where: { digest: session, userId: user.id, purpose: "SESSION", expiresAt: { gt: verifiedAt } } });
      if (!activeSession) throw new ApiError(401, "SESSION_REQUIRED", "Sign in with a valid workspace session");
      const binding = treasuryProofBinding(treasury.id, session);
      await tx.workspaceCredential.deleteMany({ where: { userId: user.id, purpose: { startsWith: binding } } });
      await tx.workspaceCredential.create({ data: {
        digest: credentialDigest(binding + publicKey),
        userId: user.id,
        purpose: binding + publicKey,
        expiresAt: new Date(Math.min(activeSession.expiresAt.getTime(), verifiedAt.getTime() + 10 * 60_000)),
      } });
      await tx.auditEvent.create({ data: {
        organizationId: user.organizationId, actorId: user.id, eventType: "TREASURY_OWNERSHIP_VERIFIED",
        description: "Verified NEAR mainnet treasury ownership using a signed message",
        metadataJson: JSON.stringify({ treasuryIdentityId: treasury.id, accountId, publicKey, verifiedAt }),
        requestId: request.id,
      } });
    });
    return { data: { accountId, verifiedAt } };
  });
}
