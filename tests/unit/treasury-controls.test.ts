import { describe, expect, it } from "vitest";
import type { PolicyEvaluationInput, VendorRiskInput } from "@covendro/shared";
import { evaluateTreasuryPolicy } from "../../apps/api/src/services/policy-engine.js";
import { assessVendorRisk } from "../../apps/api/src/services/vendor-risk-service.js";

const policy = {
  id: "policy-1",
  version: 1,
  maxPaymentPerTransactionMinor: 500000,
  maxDailyPaymentTotalMinor: 2500000,
  allowedCurrencies: ["USDC", "USDT"],
  allowedChains: ["near", "ethereum", "base"],
  allowedRecipients: ["northstar.near"],
  requireApprovalAboveMinor: 100000,
  blockUnknownRecipients: true,
  warningsRequireManualReview: true,
  allowSelfApproval: false,
  freezePayments: false,
  demoMode: true,
};

function evaluation(overrides: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return { amountMinor: 64000, currency: "USDC", paymentChain: "near", paymentDestination: "northstar.near", existingDailyTotalMinor: 0, policy, ...overrides };
}

function vendor(overrides: Partial<VendorRiskInput> = {}): VendorRiskInput {
  return { vendorName: "Northstar", vendorAddress: "northstar.near", vendorChain: "near", allowlisted: true, previousPaymentCount: 2, destinationChanged: false, duplicateInvoice: false, duplicateDocument: false, amountMinor: 64000, policyDecision: "ALLOW", ...overrides };
}

describe("treasury controls", () => {
  it("allows a known recipient within policy", () => {
    expect(evaluateTreasuryPolicy(evaluation())).toMatchObject({ decision: "ALLOW", requiredApprovals: 0, policyVersion: "1" });
  });

  it("warns when the approval threshold is crossed", () => {
    const result = evaluateTreasuryPolicy(evaluation({ amountMinor: 150000 }));
    expect(result.decision).toBe("WARN");
    expect(result.requiredApprovals).toBe(1);
    expect(result.reasons.join(" ")).toContain("approval threshold");
  });

  it("blocks frozen, unknown, and over-limit payments", () => {
    expect(evaluateTreasuryPolicy(evaluation({ paymentDestination: "unknown.near" })).decision).toBe("BLOCK");
    expect(evaluateTreasuryPolicy(evaluation({ amountMinor: 500001 })).decision).toBe("BLOCK");
    expect(evaluateTreasuryPolicy(evaluation({ policy: { ...policy, freezePayments: true } })).decision).toBe("BLOCK");
  });

  it("blocks malformed or duplicate vendor requests and explains warnings", () => {
    const result = assessVendorRisk(vendor({ vendorAddress: "BAD ADDRESS!", duplicateInvoice: true }));
    expect(result.decision).toBe("BLOCK");
    expect(result.reasons.join(" ")).toContain("account format");
    expect(result.reasons.join(" ")).toContain("matching invoice number");
  });

  it("warns for an unallowlisted recipient without a policy block", () => {
    const result = assessVendorRisk(vendor({ allowlisted: false, policyDecision: "WARN" }));
    expect(result.decision).toBe("WARN");
    expect(result.reasons.join(" ")).toContain("allowlist");
  });
});
