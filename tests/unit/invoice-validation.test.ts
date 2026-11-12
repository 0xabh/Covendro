import { describe, expect, it } from "vitest";
import { invoiceInputSchema, toMinorUnits } from "@covendro/shared";

const validInvoice = {
  vendorName: "Northstar Design Co.",
  vendorAddress: "northstar.near",
  vendorChain: "near",
  invoiceNumber: "NS-UNIT-001",
  invoiceDate: "2026-11-01",
  dueDate: "2026-11-15",
  currency: "USDC",
  amount: "1250.00",
  lineItems: [{ description: "Design work", quantity: "1", unitAmount: "1250.00" }],
  paymentDestination: "northstar.near",
  paymentChain: "near",
};

describe("invoice input validation", () => {
  it("accepts a valid NEAR invoice and converts major units to minor units", () => {
    expect(invoiceInputSchema.safeParse(validInvoice).success).toBe(true);
    expect(toMinorUnits("1250.00")).toBe(125000);
  });

  it("rejects missing amount, invalid dates, and unsupported currencies", () => {
    const result = invoiceInputSchema.safeParse({
      ...validInvoice,
      amount: "",
      invoiceDate: "2026-02-30",
      currency: "USD",
    });

    expect(result.success).toBe(false);
    if (result.success) return;

    const paths = result.error.issues.map((issue) => issue.path.join("."));
    expect(paths).toContain("amount");
    expect(paths).toContain("invoiceDate");
    expect(paths).toContain("currency");
  });

  it("rejects malformed payment destinations", () => {
    const result = invoiceInputSchema.safeParse({ ...validInvoice, paymentDestination: "INVALID ADDRESS" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.map((issue) => issue.path.join("."))).toContain("paymentDestination");
  });

  it("rejects a due date before the invoice date", () => {
    const result = invoiceInputSchema.safeParse({ ...validInvoice, dueDate: "2026-10-31" });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues.some((issue) => issue.path[0] === "dueDate")).toBe(true);
  });
});
