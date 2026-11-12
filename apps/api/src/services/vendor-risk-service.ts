import type { TreasuryDecision, VendorRiskInput, VendorRiskResult } from "@covendro/shared";

function highestDecision(decisions: TreasuryDecision[]): TreasuryDecision {
  if (decisions.includes("BLOCK")) return "BLOCK";
  if (decisions.includes("WARN")) return "WARN";
  return "ALLOW";
}

export function assessVendorRisk(input: VendorRiskInput): VendorRiskResult {
  const decisions: TreasuryDecision[] = [];
  const reasons: string[] = [];
  let riskScore = 0;

  const validNear = /^[a-z0-9._-]{2,64}$/.test(input.vendorAddress);
  const validEvm = /^0x[a-fA-F0-9]{40}$/.test(input.vendorAddress);
  const validAddress = input.vendorChain === "near" ? validNear : input.vendorChain === "ethereum" || input.vendorChain === "base" ? validEvm : validNear || validEvm;
  if (!input.vendorName || !input.vendorAddress || !input.vendorChain) {
    decisions.push("BLOCK");
    reasons.push("Vendor identity or chain information is incomplete.");
    riskScore += 50;
  } else if (!validAddress) {
    decisions.push("BLOCK");
    reasons.push("Vendor account format does not match the selected chain.");
    riskScore += 60;
  }
  if (input.duplicateInvoice || input.duplicateDocument) {
    decisions.push("BLOCK");
    reasons.push(input.duplicateInvoice ? "A matching invoice number already exists for this vendor." : "The uploaded document matches a previously processed document.");
    riskScore += 50;
  }
  if (!input.allowlisted) {
    decisions.push("WARN");
    reasons.push("Vendor is not on the treasury allowlist.");
    riskScore += 25;
  }
  if (input.destinationChanged) {
    decisions.push("WARN");
    reasons.push("Payment destination differs from a previous invoice for this vendor.");
    riskScore += 25;
  }
  if (input.previousPaymentCount === 0) {
    reasons.push("No previous payment history was found for this vendor.");
    riskScore += 5;
  }
  if (input.amountMinor >= 500_000) {
    decisions.push("WARN");
    reasons.push("Invoice amount is unusually high for the demo risk rules.");
    riskScore += 15;
  }
  if (input.policyDecision === "BLOCK") {
    decisions.push("BLOCK");
    reasons.push("Treasury policy blocked this payment request.");
    riskScore += 40;
  } else if (input.policyDecision === "WARN") {
    decisions.push("WARN");
    reasons.push("Treasury policy requires additional review for this payment request.");
    riskScore += 10;
  }

  const decision = highestDecision(decisions);
  return {
    decision,
    reasons: reasons.length ? reasons : ["Vendor passed the deterministic risk checks."],
    requiredApprovals: decision === "BLOCK" ? 0 : input.amountMinor >= 100_000 ? 1 : 0,
    policyVersion: "vendor-rules-v1",
    riskScore: Math.min(riskScore, 100),
  };
}
