import { z } from "zod";

export const treasuryDecisions = ["ALLOW", "WARN", "BLOCK"] as const;
export type TreasuryDecision = (typeof treasuryDecisions)[number];

export type TreasuryPolicySnapshot = {
  id: string;
  version: number;
  maxPaymentPerTransactionMinor: number;
  maxDailyPaymentTotalMinor: number;
  allowedCurrencies: string[];
  allowedChains: string[];
  allowedRecipients: string[];
  requireApprovalAboveMinor: number;
  blockUnknownRecipients: boolean;
  warningsRequireManualReview: boolean;
  allowSelfApproval: boolean;
  freezePayments: boolean;
  demoMode: boolean;
};

export type DecisionResult = {
  decision: TreasuryDecision;
  reasons: string[];
  requiredApprovals: number;
  policyVersion: string;
};

export type VendorRiskInput = {
  vendorName: string;
  vendorAddress: string;
  vendorChain?: string | null;
  allowlisted: boolean;
  previousPaymentCount: number;
  destinationChanged: boolean;
  duplicateInvoice: boolean;
  duplicateDocument: boolean;
  amountMinor: number;
  policyDecision: TreasuryDecision;
};

export type VendorRiskResult = DecisionResult & { riskScore: number };

export type PolicyEvaluationInput = {
  amountMinor: number;
  currency: string;
  paymentChain?: string | null;
  paymentDestination: string;
  existingDailyTotalMinor: number;
  policy: TreasuryPolicySnapshot;
};

export const treasuryPolicyUpdateSchema = z.object({
  maxPaymentPerTransactionMinor: z.number().int().nonnegative(),
  maxDailyPaymentTotalMinor: z.number().int().nonnegative(),
  allowedCurrencies: z.array(z.string().trim().min(1)).min(1),
  allowedChains: z.array(z.string().trim().min(1)).min(1),
  allowedRecipients: z.array(z.string().trim().min(1)),
  requireApprovalAboveMinor: z.number().int().nonnegative(),
  blockUnknownRecipients: z.boolean(),
  warningsRequireManualReview: z.boolean(),
  allowSelfApproval: z.boolean(),
  freezePayments: z.boolean(),
  demoMode: z.boolean(),
});

export type TreasuryPolicyUpdate = z.infer<typeof treasuryPolicyUpdateSchema>;

export function csvToList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

export function policyToSnapshot(policy: {
  id: string;
  version: number;
  maxPaymentPerTransactionMinor: number;
  maxDailyPaymentTotalMinor: number;
  allowedCurrenciesCsv: string;
  allowedChainsCsv: string;
  allowedRecipientsCsv: string;
  requireApprovalAboveMinor: number;
  blockUnknownRecipients: boolean;
  warningsRequireManualReview: boolean;
  allowSelfApproval: boolean;
  freezePayments: boolean;
  demoMode: boolean;
}): TreasuryPolicySnapshot {
  return {
    id: policy.id,
    version: policy.version,
    maxPaymentPerTransactionMinor: policy.maxPaymentPerTransactionMinor,
    maxDailyPaymentTotalMinor: policy.maxDailyPaymentTotalMinor,
    allowedCurrencies: csvToList(policy.allowedCurrenciesCsv),
    allowedChains: csvToList(policy.allowedChainsCsv),
    allowedRecipients: csvToList(policy.allowedRecipientsCsv),
    requireApprovalAboveMinor: policy.requireApprovalAboveMinor,
    blockUnknownRecipients: policy.blockUnknownRecipients,
    warningsRequireManualReview: policy.warningsRequireManualReview,
    allowSelfApproval: policy.allowSelfApproval,
    freezePayments: policy.freezePayments,
    demoMode: policy.demoMode,
  };
}
