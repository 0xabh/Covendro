import type { Organization, TreasuryPolicy, User, Vendor } from "@prisma/client";
import { prisma } from "../db/prisma.js";

export type OrganizationSnapshot = Organization & {
  users: User[];
  vendors: Vendor[];
  policies: TreasuryPolicy[];
};

export async function getOrganizationSnapshot(slug: string): Promise<OrganizationSnapshot | null> {
  return prisma.organization.findUnique({
    where: { slug },
    include: {
      users: { orderBy: { createdAt: "asc" } },
      vendors: { orderBy: { createdAt: "asc" } },
      policies: { where: { active: true }, orderBy: { version: "desc" } },
    },
  });
}

export async function getDemoUser(email = "submitter@covendro.local") {
  return prisma.user.findUnique({
    where: { email },
    include: { organization: true },
  });
}
