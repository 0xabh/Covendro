import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL ?? "file:./dev.db" },
  },
});

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "covendro-demo" },
    update: { name: "Covendro Demo Treasury" },
    create: {
      name: "Covendro Demo Treasury",
      slug: "covendro-demo",
    },
  });

  const users = [
    { name: "Tara Treasury", email: "treasury@covendro.local", role: "TREASURY_ADMINISTRATOR", nearAccountId: "treasury.covendro.testnet" },
    { name: "Ravi Reviewer", email: "reviewer@covendro.local", role: "REVIEWER", nearAccountId: "reviewer.covendro.testnet" },
    { name: "Sam Submitter", email: "submitter@covendro.local", role: "SUBMITTER", nearAccountId: "submitter.covendro.testnet" },
  ];

  for (const user of users) {
    await prisma.user.upsert({
      where: { email: user.email },
      update: { ...user, organizationId: organization.id },
      create: { ...user, organizationId: organization.id },
    });
  }

  await prisma.treasuryIdentity.upsert({
    where: { organizationId_nearAccountId: { organizationId: organization.id, nearAccountId: "treasury.covendro.testnet" } },
    update: { name: "Covendro Demo Treasury Key", keyPurpose: "POLICY_APPROVAL_AND_RELAY", accessKeyPermissionScope: "Demo-only function-call metadata; no transfer authority", keyType: "FUNCTION_CALL", demoIdentity: true },
    create: { organizationId: organization.id, name: "Covendro Demo Treasury Key", nearAccountId: "treasury.covendro.testnet", keyPurpose: "POLICY_APPROVAL_AND_RELAY", accessKeyPermissionScope: "Demo-only function-call metadata; no transfer authority", keyType: "FUNCTION_CALL", demoIdentity: true },
  });

  const vendors = [
    {
      name: "Northstar Design Co.",
      accountAddress: "northstar.near",
      accountChain: "near",
      allowlisted: true,
      riskStatus: "ALLOW",
    },
    {
      name: "Harbor Data Services",
      accountAddress: "0x1111111111111111111111111111111111111111",
      accountChain: "ethereum",
      allowlisted: false,
      riskStatus: "UNKNOWN",
    },
  ];

  for (const vendor of vendors) {
    await prisma.vendor.upsert({
      where: {
        organizationId_accountAddress: {
          organizationId: organization.id,
          accountAddress: vendor.accountAddress,
        },
      },
      update: vendor,
      create: { ...vendor, organizationId: organization.id },
    });
  }

  await prisma.treasuryPolicy.upsert({
    where: {
      organizationId_version: {
        organizationId: organization.id,
        version: 1,
      },
    },
    update: {
      maxPaymentPerTransactionMinor: 500000,
      maxDailyPaymentTotalMinor: 2500000,
      allowedCurrenciesCsv: "USDC,USDT",
      allowedChainsCsv: "near,ethereum,base",
      allowedRecipientsCsv: "northstar.near",
      requireApprovalAboveMinor: 100000,
      blockUnknownRecipients: true,
      warningsRequireManualReview: true,
      allowSelfApproval: false,
      freezePayments: false,
      demoMode: true,
      active: true,
    },
    create: {
      organizationId: organization.id,
      version: 1,
      maxPaymentPerTransactionMinor: 500000,
      maxDailyPaymentTotalMinor: 2500000,
      allowedCurrenciesCsv: "USDC,USDT",
      allowedChainsCsv: "near,ethereum,base",
      allowedRecipientsCsv: "northstar.near",
      requireApprovalAboveMinor: 100000,
      blockUnknownRecipients: true,
      warningsRequireManualReview: true,
      allowSelfApproval: false,
      freezePayments: false,
      demoMode: true,
      active: true,
    },
  });

  console.log(`Seeded organization ${organization.slug}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
