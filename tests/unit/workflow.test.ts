import { describe, expect, it } from "vitest";
import { canTransitionInvoice } from "@covendro/shared";

describe("invoice workflow transitions", () => {
  it("allows the normal review path and explicit rejected resubmission", () => {
    expect(canTransitionInvoice("DRAFT", "EXTRACTED")).toBe(true);
    expect(canTransitionInvoice("EXTRACTED", "REVIEW_REQUIRED")).toBe(true);
    expect(canTransitionInvoice("REVIEW_REQUIRED", "APPROVED")).toBe(true);
    expect(canTransitionInvoice("REVIEW_REQUIRED", "REJECTED")).toBe(true);
    expect(canTransitionInvoice("REJECTED", "REVIEW_REQUIRED")).toBe(true);
  });

  it("rejects unsafe or backwards transitions", () => {
    expect(canTransitionInvoice("BLOCKED", "APPROVED")).toBe(false);
    expect(canTransitionInvoice("REJECTED", "APPROVED")).toBe(false);
    expect(canTransitionInvoice("PAID", "APPROVED")).toBe(false);
  });
});
