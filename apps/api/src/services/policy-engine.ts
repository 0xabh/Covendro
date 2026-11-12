import type { PolicyEvaluationInput, TreasuryDecision, DecisionResult } from "@covendro/shared";

export function evaluateTreasuryPolicy(input: PolicyEvaluationInput): DecisionResult {
  const decisions: TreasuryDecision[] = [];
  const reasons: string[] = [];
  const { policy } = input;
  const recipientAllowed = policy.allowedRecipients.includes(input.paymentDestination);

  if (policy.freezePayments) {
    decisions.push("BLOCK");
    reasons.push("Treasury payment execution is frozen by the active policy.");
  }
  if (!policy.allowedCurrencies.includes(input.currency)) {
    decisions.push("BLOCK");
    reasons.push(`${input.currency} is not an allowed treasury currency.`);
  }
  if (!input.paymentChain || !policy.allowedChains.includes(input.paymentChain)) {
    decisions.push("BLOCK");
    reasons.push(`${input.paymentChain ?? "No chain"} is not an allowed payment chain.`);
  }
  if (input.amountMinor > policy.maxPaymentPerTransactionMinor) {
    decisions.push("BLOCK");
    reasons.push("Payment exceeds the maximum amount per transaction.");
  }
  if (input.existingDailyTotalMinor + input.amountMinor > policy.maxDailyPaymentTotalMinor) {
    decisions.push("BLOCK");
    reasons.push("Payment would exceed the maximum daily treasury total.");
  }
  if (!recipientAllowed) {
    decisions.push(policy.blockUnknownRecipients ? "BLOCK" : "WARN");
    reasons.push(policy.blockUnknownRecipients ? "Recipient is not on the treasury allowlist." : "Recipient is not on the treasury allowlist and requires manual review.");
  }

  const requiredApprovals = input.amountMinor > policy.requireApprovalAboveMinor ? 1 : 0;
  if (requiredApprovals > 0) reasons.push("Payment exceeds the approval threshold and requires reviewer approval.");
  if (policy.demoMode) reasons.push("Demo mode is enabled; execution must use a mock or explicitly dry payment rail.");

  let decision: TreasuryDecision = "ALLOW";
  if (decisions.includes("BLOCK")) decision = "BLOCK";
  else if (decisions.includes("WARN") || (requiredApprovals > 0 && policy.warningsRequireManualReview)) decision = "WARN";

  return {
    decision,
    reasons: reasons.length ? reasons : ["Payment satisfies the active treasury policy."],
    requiredApprovals,
    policyVersion: String(policy.version),
  };
}
