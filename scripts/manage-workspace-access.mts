import { prisma } from "../apps/api/src/db/prisma.js";
import { credentialDigest, generateCredential } from "../apps/api/src/services/workspace-access.js";

const [action, slug, rawEmail, name, role] = process.argv.slice(2);
const email = rawEmail?.trim().toLowerCase();
const roles = ["SUBMITTER", "REVIEWER", "TREASURY_SIGNER", "TREASURY_ADMINISTRATOR", "AUDITOR"];

try {
  if (process.env.DEMO_MODE !== "false" || !process.env.DATABASE_URL || !slug || slug === "covendro-demo") {
    throw new Error("Set DEMO_MODE=false, an explicit pilot DATABASE_URL, and a pilot slug.");
  }
  if (await prisma.organization.findUnique({ where: { slug: "covendro-demo" } })) {
    throw new Error("Use a separate database without demo seed data.");
  }
  if (action === "bootstrap") {
    const workspaceName = rawEmail?.trim();
    if (!workspaceName) throw new Error("Use bootstrap <workspace-slug> <workspace-name>.");
    await prisma.organization.create({ data: {
      slug, name: workspaceName,
      policies: { create: {
        version: 1, maxPaymentPerTransactionMinor: 0, maxDailyPaymentTotalMinor: 0,
        allowedCurrenciesCsv: "USDC", allowedChainsCsv: "near,base", allowedRecipientsCsv: "",
        requireApprovalAboveMinor: 0, freezePayments: true, demoMode: false,
      } },
    } });
    process.stdout.write("Workspace created with treasury frozen.\n");
  } else if (action === "treasury") {
    const accountId = rawEmail?.trim();
    if (!accountId || !/^(?!.*\.testnet$)(?=.{2,64}$)[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(accountId)) {
      throw new Error("Use treasury <workspace-slug> <public-near-mainnet-account>.");
    }
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug } });
    await prisma.$transaction(async (tx) => {
      if (await tx.treasuryIdentity.count({ where: { organizationId: organization.id } })) {
        throw new Error("This workspace already has a treasury account. Treasury rotation requires a dedicated migration.");
      }
      await tx.treasuryIdentity.create({ data: {
        organizationId: organization.id, nearAccountId: accountId, name: "Pilot Treasury",
        keyPurpose: "QUOTE_REFUND_DESTINATION", accessKeyPermissionScope: "Ownership pending verification",
        keyType: "UNVERIFIED", demoIdentity: false,
      } });
      await tx.auditEvent.create({ data: {
        organizationId: organization.id, eventType: "PILOT_TREASURY_CONFIGURED",
        description: "Operator configured the workspace treasury for dry quote refunds",
        metadataJson: JSON.stringify({ accountId }),
      } });
    });
    process.stdout.write("Treasury account configured for previews.\n");
  } else {
    if (!email?.includes("@") || email.endsWith("@covendro.local")) throw new Error("Enter an eligible workspace email.");
    const organization = await prisma.organization.findUniqueOrThrow({ where: { slug } });
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.organizationId !== organization.id) throw new Error("This email belongs to another workspace.");

    if (action === "revoke" && existing) {
      await prisma.workspaceCredential.deleteMany({ where: { userId: existing.id } });
      process.stdout.write("Workspace access revoked.\n");
    } else if (action === "invite" && name && role && roles.includes(role)) {
      const invite = generateCredential();
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.upsert({
          where: { email },
          create: { email, name, role, organizationId: organization.id },
          update: { name, role },
        });
        await tx.workspaceCredential.deleteMany({ where: { userId: user.id } });
        await tx.workspaceCredential.create({
          data: {
            userId: user.id,
            digest: credentialDigest(invite),
            purpose: "INVITE",
            expiresAt: new Date(Date.now() + 30 * 60 * 1000),
          },
        });
      });
      process.stdout.write(invite + "\n");
    } else {
      throw new Error("Use invite <workspace-slug> <email> <name> <role> or revoke <workspace-slug> <email>.");
    }
  }
} catch (error) {
  process.stderr.write((error instanceof Error ? error.message : "Workspace access operation failed") + "\n");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
