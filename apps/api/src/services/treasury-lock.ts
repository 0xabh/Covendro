import type { Prisma } from "@prisma/client";

export async function lockTreasuryWorkspace(db: Prisma.TransactionClient, organizationId: string) {
  // Acquire the same workspace row lock for policy, destination and debit changes.
  await db.organization.update({ where: { id: organizationId }, data: { updatedAt: new Date() }, select: { id: true } });
}
