export const invoiceStatuses = [
  "DRAFT",
  "EXTRACTED",
  "REVIEW_REQUIRED",
  "APPROVED",
  "QUOTE_REQUESTED",
  "QUOTE_READY",
  "PAYMENT_PENDING",
  "PAID",
  "REJECTED",
  "BLOCKED",
  "EXPIRED",
  "REFUNDED",
  "FAILED",
] as const;

export type InvoiceStatus = (typeof invoiceStatuses)[number];

const allowedTransitions: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ["EXTRACTED", "REVIEW_REQUIRED", "BLOCKED"],
  EXTRACTED: ["REVIEW_REQUIRED", "BLOCKED"],
  REVIEW_REQUIRED: ["APPROVED", "REJECTED", "BLOCKED"],
  APPROVED: ["QUOTE_REQUESTED", "FAILED"],
  QUOTE_REQUESTED: ["QUOTE_READY", "FAILED", "EXPIRED"],
  QUOTE_READY: ["PAYMENT_PENDING", "EXPIRED", "FAILED"],
  PAYMENT_PENDING: ["PAID", "REFUNDED", "FAILED"],
  PAID: ["REFUNDED"],
  REJECTED: ["REVIEW_REQUIRED"],
  BLOCKED: ["REVIEW_REQUIRED"],
  EXPIRED: ["QUOTE_REQUESTED"],
  REFUNDED: [],
  FAILED: ["QUOTE_REQUESTED"],
};

export function canTransitionInvoice(from: string, to: InvoiceStatus) {
  return (allowedTransitions[from as InvoiceStatus] ?? []).includes(to);
}
