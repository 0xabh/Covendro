import { z } from "zod";

export const supportedCurrencies = ["USDC", "USDT"] as const;
export const supportedChains = ["near", "ethereum", "base"] as const;

const dateString = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Use a valid date in YYYY-MM-DD format");

const decimalString = z.string().trim().regex(/^\d+(\.\d{1,2})?$/, "Use a positive amount with up to 2 decimals");

export const invoiceLineItemInputSchema = z.object({
  description: z.string().trim().min(1, "Line item description is required"),
  quantity: decimalString,
  unitAmount: decimalString,
});

export const sourceDocumentSchema = z.object({
  fileName: z.string().trim().min(1),
  fileType: z.string().trim().min(1),
  content: z.string().max(2_000_000, "Document is too large for the MVP"),
  encoding: z.enum(["utf8", "base64"]).default("utf8"),
});

export const invoiceInputSchema = z.object({
  vendorName: z.string().trim().min(1, "Vendor name is required"),
  vendorAddress: z.string().trim().min(1, "Vendor account is required"),
  vendorChain: z.enum(supportedChains).optional(),
  invoiceNumber: z.string().trim().min(1, "Invoice number is required").max(120),
  invoiceDate: dateString,
  dueDate: dateString.optional(),
  currency: z.enum(supportedCurrencies, { errorMap: () => ({ message: "Currency must be USDC or USDT" }) }),
  amount: decimalString,
  lineItems: z.array(invoiceLineItemInputSchema).min(1, "At least one line item is required"),
  paymentDestination: z.string().trim().min(1, "Payment destination is required"),
  paymentChain: z.enum(supportedChains).optional(),
  memo: z.string().trim().max(500).optional(),
  sourceDocument: sourceDocumentSchema.optional(),
}).superRefine((value, context) => {
  if (value.dueDate && value.dueDate < value.invoiceDate) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["dueDate"], message: "Due date cannot be before invoice date" });
  }

  const chain = value.paymentChain ?? value.vendorChain;
  const destination = value.paymentDestination;
  const validNear = /^[a-z0-9._-]{2,64}$/.test(destination);
  const validEvm = /^0x[a-fA-F0-9]{40}$/.test(destination);

  if (chain === "near" && !validNear) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["paymentDestination"], message: "Enter a valid NEAR account" });
  }

  if ((chain === "ethereum" || chain === "base") && !validEvm) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["paymentDestination"], message: "Enter a valid EVM address" });
  }

  if (!chain && !validNear && !validEvm) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["paymentDestination"], message: "Enter a valid NEAR account or EVM address" });
  }
});

export type InvoiceInput = z.infer<typeof invoiceInputSchema>;

export type InvoiceValidationError = {
  path: string[];
  message: string;
};

export function toMinorUnits(value: string): number {
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

export function lineItemToMinorUnits(value: { quantity: string; unitAmount: string }) {
  return Math.round(Number(value.quantity) * toMinorUnits(value.unitAmount));
}
