import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { serializeNep413 } from "@near-wallet-selector/core";
import { expect, it, vi } from "vitest";
import { buildApp } from "../../apps/api/src/app.js";
import { prisma } from "../../apps/api/src/db/prisma.js";
import { treasuryProofDigest } from "../../apps/api/src/routes/treasury-proof-routes.js";
import { credentialDigest, generateCredential } from "../../apps/api/src/services/workspace-access.js";

function base58(bytes: Buffer) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let value = BigInt("0x" + bytes.toString("hex"));
  let result = "";
  while (value > 0n) {
    result = alphabet[Number(value % 58n)] + result;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    result = "1" + result;
  }
  return result;
}

it.each([undefined, "my-near-wallet"] as const)("confirms a session-bound treasury challenge using wallet mode %s", async (wallet) => {
  const origin = "https://covendro.example";
  const accountId = "treasury.near";
  vi.stubEnv("WEB_ORIGIN", origin);
  vi.stubEnv("DEMO_MODE", "false");
  vi.stubEnv("NEAR_TREASURY_RPC_URL", "https://rpc.example");
  const mockRpc = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ result: { chain_id: "mainnet" } }))
    .mockResolvedValueOnce(Response.json({ result: { permission: "FullAccess" } }));
  vi.stubGlobal("fetch", mockRpc);
  const app = buildApp();
  const token = generateCredential();
  const otherToken = generateCredential();
  const organization = await prisma.organization.create({ data: {
    slug: "treasury-proof-integration",
    name: "Treasury proof",
    users: { create: {
      name: "Treasury signer", email: "signer@proof.example", role: "TREASURY_SIGNER",
      workspaceCredentials: { create: [token, otherToken].map((credential) => ({
        digest: credentialDigest(credential), purpose: "SESSION", expiresAt: new Date(Date.now() + 60_000),
      })) },
    } },
    treasuryIdentities: { create: {
      nearAccountId: accountId, name: "Treasury", keyPurpose: "OWNERSHIP", accessKeyPermissionScope: "External wallet",
      keyType: "UNVERIFIED", demoIdentity: false,
    } },
  } });
  try {
    const headers = { origin, cookie: `__Host-covendro=${token}` };
    const challenge = await app.inject({ method: "POST", url: "/api/treasury/proof/challenge", headers, ...(wallet ? { payload: { wallet } } : {}) });
    expect(challenge.statusCode).toBe(200);
    const { nonce, message, recipient, callbackUrl } = challenge.json().data;
    expect(callbackUrl).toBe(wallet ? origin + "/" : undefined);
    const keys = generateKeyPairSync("ed25519");
    const rawKey = keys.publicKey.export({ type: "spki", format: "der" }).subarray(-32);
    const publicKey = "ed25519:" + base58(rawKey);
    const nonceBytes = Buffer.from(nonce, "base64url");
    const sdkDigest = createHash("sha256").update(serializeNep413({ message, nonce: nonceBytes, recipient, callbackUrl })).digest();
    expect(treasuryProofDigest(message, nonceBytes, recipient, callbackUrl)).toEqual(sdkDigest);
    const signature = sign(null, sdkDigest, keys.privateKey).toString("base64");
    const request = { method: "POST" as const, url: "/api/treasury/proof", headers, payload: { nonce, accountId, publicKey, signature, ...(wallet ? { wallet } : {}) } };
    expect((await app.inject({ ...request, headers: { origin, cookie: `__Host-covendro=${otherToken}` } })).statusCode).toBe(409);
    if (wallet) expect((await app.inject({ ...request, payload: { nonce, accountId, publicKey, signature } })).statusCode).toBe(409);
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(409);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(await prisma.auditEvent.count({ where: { organizationId: organization.id, eventType: "TREASURY_OWNERSHIP_VERIFIED" } })).toBe(1);
  } finally {
    await prisma.organization.delete({ where: { id: organization.id } });
    await app.close();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  }
});
